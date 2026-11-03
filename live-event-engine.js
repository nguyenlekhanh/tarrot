'use strict';

/**
 * Sunny Side Sips — high-volume TikTok event engine.
 *
 * This module is deliberately independent of Express, the shop state and the
 * browser. It gives the server:
 *   - bounded per-type queues with fair, weighted draining;
 *   - reliable-event-ID deduplication;
 *   - a single-window like batcher (no timer per viewer);
 *   - gift combo accounting that never re-orders an already counted repeat.
 *
 * Everything here is synchronous or uses setImmediate. Handlers must keep their
 * own work small; chat/LLM work stays in the existing reactive queue.
 */

const EVENT_TYPES = Object.freeze(['GIFT', 'FOLLOW', 'MEMBER', 'SHARE', 'CHAT', 'LIKE']);
const EVENT_PRIORITIES = Object.freeze({
  GIFT: 5,
  FOLLOW: 4,
  MEMBER: 3,
  SHARE: 2,
  CHAT: 1,
  LIKE: 0
});
const DEFAULT_LIMITS = Object.freeze({
  GIFT: 2000,
  FOLLOW: 1500,
  MEMBER: 3000,
  SHARE: 1000,
  CHAT: 2000,
  LIKE: 3000
});
const DRAIN_ROTATION = Object.freeze([
  'GIFT',
  'FOLLOW',
  'GIFT',
  'MEMBER',
  'SHARE',
  'GIFT',
  'FOLLOW',
  'CHAT',
  'MEMBER',
  'GIFT'
]);

const DEFAULT_LIKE_REACTIONS = Object.freeze([
  { threshold: 10, text: 'Thank you for the love!' },
  { threshold: 50, text: 'Wow! Everyone is showing us some love!' },
  { threshold: 100, text: 'One hundred likes! You guys are amazing!' },
  { threshold: 500, text: 'Look at all those likes! Thank you, everyone!' }
]);

const LIKE_WINDOWS = Object.freeze([3, 5, 10, 15]);

function clampInt(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function normalizeEventType(type) {
  const value = String(type || '').trim().toUpperCase();
  return EVENT_TYPES.includes(value) ? value : null;
}

function normalizeLikeReactions(thresholds) {
  const source = Array.isArray(thresholds) ? thresholds : DEFAULT_LIKE_REACTIONS.map((item) => item.threshold);
  const values = [...new Set(source
    .map((value) => clampInt(value && typeof value === 'object' ? value.threshold : value, 0, 0, 1000000))
    .filter((value) => value > 0))]
    .sort((a, b) => a - b)
    .slice(0, 8);
  const fallback = DEFAULT_LIKE_REACTIONS.map((item) => item.threshold);
  const finalThresholds = values.length ? values : fallback;
  return finalThresholds.map((threshold) => {
    const found = DEFAULT_LIKE_REACTIONS.find((item) => item.threshold === threshold);
    return {
      threshold,
      text: found ? found.text : `${threshold.toLocaleString('en-US')} likes! Thank you, everyone!`
    };
  });
}

function normalizeLikeBatching(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: source.enabled !== false,
    windowSeconds: LIKE_WINDOWS.includes(Number(source.windowSeconds)) ? Number(source.windowSeconds) : 5,
    minLikes: clampInt(source.minLikes, 10, 1, 100000),
    cooldownSeconds: clampInt(source.cooldownSeconds, 20, 0, 300),
    thresholds: normalizeLikeReactions(source.thresholds)
  };
}

class GiftComboTracker {
  constructor(options = {}) {
    this.maxEntries = clampInt(options.maxEntries, 500, 10, 5000);
    this.entries = new Map();
  }

  /**
   * Returns only the newly-added repeats. A repeated payload that does not
   * advance the combo produces delta 0, so it cannot create another order.
   */
  apply(groupId, repeatCount, repeatEnd = false) {
    const key = String(groupId || '').slice(0, 120);
    if (!key) return { delta: 0, ignored: true, reason: 'missing_group' };
    const count = clampInt(repeatCount, 1, 1, 1000000);
    const previous = this.entries.get(key);
    if (previous && count <= previous.count) {
      return { delta: 0, ignored: true, previous: previous.count, count, ended: Boolean(repeatEnd) };
    }
    const delta = previous ? count - previous.count : count;
    this.entries.delete(key);
    this.entries.set(key, { count, at: Date.now() });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      this.entries.delete(oldest);
    }
    return { delta, ignored: false, previous: previous ? previous.count : 0, count, ended: Boolean(repeatEnd) };
  }

  reset() {
    this.entries.clear();
  }

  size() {
    return this.entries.size;
  }
}

class LikeBatcher {
  constructor(settings = {}, options = {}) {
    this.clock = typeof options.clock === 'function' ? options.clock : () => Date.now();
    this.maxViewers = clampInt(options.maxViewers, 2000, 10, 10000);
    this.settings = normalizeLikeBatching(settings);
    this.entries = new Map();
    this.overflow = { count: 0, events: 0 };
    this.totalLikes = 0;
    this.totalEvents = 0;
    this.startedAt = 0;
    this.lastFlushAt = 0;
    this.lastReactionAt = 0;
    this.speechDeferredUntil = 0;
    this.reactionsGenerated = 0;
    this.batchesFlushed = 0;
    this.suppressedReactions = 0;
    this.droppedViewers = 0;
  }

  updateSettings(raw) {
    this.settings = normalizeLikeBatching(raw);
    return this.settings;
  }

  updateSettingsFromState(state) {
    this.settings = normalizeLikeBatching(state);
  }

  viewerKey(event) {
    const uid = String(event.uniqueId || '').trim().toLowerCase();
    return uid ? `u:${uid.slice(0, 40)}` : `n:${String(event.user || 'guest').toLowerCase().slice(0, 40)}`;
  }

  /** Add one LIKE event to the current window. */
  ingest(event = {}) {
    const count = clampInt(event.count, 1, 1, 1000000);
    const now = Number(event.at) || this.clock();
    const key = this.viewerKey(event);
    const existing = this.entries.get(key);
    if (existing) {
      existing.count += count;
      existing.events += 1;
      existing.lastAt = now;
      if (event.avatar) existing.avatar = event.avatar;
      if (event.user) existing.user = event.user;
    } else if (this.entries.size < this.maxViewers) {
      this.entries.set(key, {
        key,
        user: String(event.user || event.uniqueId || 'Guest').slice(0, 80),
        uniqueId: String(event.uniqueId || '').slice(0, 40),
        avatar: String(event.avatar || '').slice(0, 500),
        count,
        events: 1,
        firstAt: now,
        lastAt: now
      });
    } else {
      // Preserve the global like total even if an unusually large number of
      // distinct viewers exceeds the per-batch identity cap.
      this.overflow.count += count;
      this.overflow.events += 1;
      this.droppedViewers += 1;
    }
    if (!this.startedAt) this.startedAt = now;
    this.totalLikes += count;
    this.totalEvents += 1;
    return { accepted: true, count, totalLikes: this.totalLikes, totalEvents: this.totalEvents };
  }

  tick(nowValue) {
    if (!this.startedAt) return null;
    const now = Number(nowValue) || this.clock();
    if (now - this.startedAt < this.settings.windowSeconds * 1000) return null;
    return this.flush({ now, reason: 'window' });
  }

  /**
   * Consume the current window and reset all pending counters before returning.
   * The caller owns state updates, one visual event and at most one speech line.
   */
  flush(options = {}) {
    if (!this.totalLikes) return null;
    const now = Number(options.now) || this.clock();
    const likes = this.totalLikes;
    const events = this.totalEvents;
    const viewers = [...this.entries.values()].map((entry) => ({ ...entry }));
    const overflow = { ...this.overflow };
    const startedAt = this.startedAt;
    this.entries.clear();
    this.overflow = { count: 0, events: 0 };
    this.totalLikes = 0;
    this.totalEvents = 0;
    this.startedAt = 0;
    this.lastFlushAt = now;

    const reaction = this.chooseReaction(likes, now, options);
    this.batchesFlushed += 1;
    if (reaction) {
      this.reactionsGenerated += 1;
      this.lastReactionAt = now;
    } else if (likes >= this.settings.minLikes) {
      this.suppressedReactions += 1;
    }

    return {
      id: `like_batch_${now}_${Math.random().toString(36).slice(2, 6)}`,
      likes,
      events,
      viewers,
      overflow,
      startedAt,
      endedAt: now,
      durationMs: Math.max(0, now - startedAt),
      reaction,
      reason: options.reason || 'manual',
      forced: options.force === true
    };
  }

  chooseReaction(likes, now, options = {}) {
    if (!this.settings.enabled) return null;
    if (likes < this.settings.minLikes) return null;
    const eligible = options.force === true ||
      (now >= this.speechDeferredUntil && now - this.lastReactionAt >= this.settings.cooldownSeconds * 1000);
    if (!eligible) return null;
    let selected = null;
    for (const tier of this.settings.thresholds) {
      if (likes >= tier.threshold) selected = tier;
      else break;
    }
    return selected ? { ...selected, likes } : null;
  }

  /**
   * Priority speech (gift/follow/VIP) can arrive while a like window is pending.
   * Suppress the next like speech without affecting the like totals.
   */
  deferSpeech(ms = 6000) {
    this.speechDeferredUntil = Math.max(this.speechDeferredUntil, this.clock() + Math.max(0, Number(ms) || 0));
  }

  resetReactionStats() {
    this.reactionsGenerated = 0;
    this.batchesFlushed = 0;
    this.suppressedReactions = 0;
    this.lastReactionAt = 0;
    this.lastFlushAt = 0;
  }

  snapshot(nowValue) {
    const now = Number(nowValue) || this.clock();
    return {
      settings: {
        ...this.settings,
        thresholds: this.settings.thresholds.map((tier) => ({ ...tier }))
      },
      pendingLikes: this.totalLikes,
      pendingEvents: this.totalEvents,
      pendingViewers: this.entries.size + (this.overflow.events ? 1 : 0),
      overflowLikes: this.overflow.count,
      overflowEvents: this.overflow.events,
      droppedViewers: this.droppedViewers,
      batchStartedAt: this.startedAt || null,
      windowRemainingMs: this.startedAt ? Math.max(0, this.settings.windowSeconds * 1000 - (now - this.startedAt)) : 0,
      lastFlushAt: this.lastFlushAt || null,
      lastReactionAt: this.lastReactionAt || null,
      cooldownRemainingMs: this.lastReactionAt
        ? Math.max(0, this.settings.cooldownSeconds * 1000 - (now - this.lastReactionAt))
        : 0,
      speechDeferredUntil: this.speechDeferredUntil || null,
      reactionsGenerated: this.reactionsGenerated,
      batchesFlushed: this.batchesFlushed,
      suppressedReactions: this.suppressedReactions
    };
  }

  clearPending() {
    this.entries.clear();
    this.overflow = { count: 0, events: 0 };
    this.totalLikes = 0;
    this.totalEvents = 0;
    this.startedAt = 0;
  }
}

class LiveEventEngine {
  constructor(options = {}) {
    this.handler = typeof options.handler === 'function' ? options.handler : null;
    this.limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
    this.maxPending = clampInt(
      options.maxPending,
      Object.values(this.limits).reduce((sum, value) => sum + value, 0),
      10,
      50000
    );
    this.dedupeTtlMs = clampInt(options.dedupeTtlMs, 10 * 60 * 1000, 1000, 60 * 60 * 1000);
    this.maxDedupeEntries = clampInt(options.maxDedupeEntries, 5000, 100, 50000);
    this.batchSize = clampInt(options.batchSize, 24, 1, 250);
    this.budgetMs = clampInt(options.budgetMs, 8, 1, 50);
    this.queues = Object.fromEntries(EVENT_TYPES.map((type) => [type, []]));
    this.pending = 0;
    this.processing = false;
    this.scheduled = false;
    this.stopped = false;
    this.rotationCursor = 0;
    this.dedupe = new Map();
    this.stats = this.freshStats();
    this.processedTimes = [];
    this.schedule = typeof options.schedule === 'function'
      ? options.schedule
      : (callback) => setImmediate(callback);
  }

  freshStats() {
    const perType = {};
    for (const type of EVENT_TYPES) {
      perType[type] = { received: 0, processed: 0, dropped: 0, duplicates: 0, errors: 0 };
    }
    return {
      perType,
      received: 0,
      processed: 0,
      dropped: 0,
      duplicates: 0,
      errors: 0,
      receivedLikes: 0,
      lastReceivedAt: null,
      lastProcessedAt: null,
      lastType: null
    };
  }

  setHandler(handler) {
    this.handler = typeof handler === 'function' ? handler : null;
  }

  start() {
    this.stopped = false;
    if (this.pending) this.scheduleDrain();
  }

  stop() {
    this.stopped = true;
  }

  clearQueues() {
    for (const type of EVENT_TYPES) this.queues[type].length = 0;
    this.pending = 0;
  }

  resetStats() {
    this.stats = this.freshStats();
    this.processedTimes = [];
  }

  checkAndRememberDuplicate(type, key) {
    if (!key) return false;
    const now = Date.now();
    const composite = `${type}:${String(key).slice(0, 160)}`;
    const previous = this.dedupe.get(composite);
    if (previous && now - previous <= this.dedupeTtlMs) {
      this.stats.duplicates += 1;
      if (this.stats.perType[type]) this.stats.perType[type].duplicates += 1;
      return true;
    }
    this.dedupe.delete(composite);
    this.dedupe.set(composite, now);
    while (this.dedupe.size > this.maxDedupeEntries) {
      this.dedupe.delete(this.dedupe.keys().next().value);
    }
    return false;
  }

  recordReceived(type, count = 1) {
    const safeType = normalizeEventType(type);
    if (!safeType) return;
    const amount = Math.max(1, Math.round(Number(count) || 1));
    this.stats.received += amount;
    this.stats.perType[safeType].received += amount;
    this.stats.lastReceivedAt = Date.now();
    this.stats.lastType = safeType;
    if (safeType === 'LIKE') this.stats.receivedLikes += amount;
  }

  recordProcessed(type, count = 1) {
    const safeType = normalizeEventType(type);
    if (!safeType) return;
    const amount = Math.max(1, Math.round(Number(count) || 1));
    const now = Date.now();
    this.stats.processed += amount;
    this.stats.perType[safeType].processed += amount;
    this.stats.lastProcessedAt = now;
    for (let i = 0; i < amount; i += 1) this.processedTimes.push(now);
    if (this.processedTimes.length > 5000) {
      this.processedTimes.splice(0, this.processedTimes.length - 5000);
    }
  }

  recordDropped(type, count = 1) {
    const safeType = normalizeEventType(type);
    if (!safeType) return;
    const amount = Math.max(1, Math.round(Number(count) || 1));
    this.stats.dropped += amount;
    this.stats.perType[safeType].dropped += amount;
  }

  recordError(type) {
    const safeType = normalizeEventType(type);
    this.stats.errors += 1;
    if (safeType) this.stats.perType[safeType].errors += 1;
  }

  push(type, payload, options = {}) {
    const safeType = normalizeEventType(type);
    if (!safeType) return { accepted: false, reason: 'unknown_type' };
    if (options.skipReceive !== true) this.recordReceived(safeType, 1);
    if (this.stopped) {
      this.recordDropped(safeType, 1);
      return { accepted: false, reason: 'stopped' };
    }
    if (this.checkAndRememberDuplicate(safeType, options.dedupeKey)) {
      return { accepted: false, duplicate: true };
    }
    if (this.pending >= this.maxPending || this.queues[safeType].length >= this.limits[safeType]) {
      this.evictLowerPriority(safeType);
    }
    if (this.pending >= this.maxPending || this.queues[safeType].length >= this.limits[safeType]) {
      this.recordDropped(safeType, 1);
      return { accepted: false, reason: 'queue_full' };
    }
    const entry = {
      type: safeType,
      payload,
      at: Date.now(),
      priority: EVENT_PRIORITIES[safeType] || 0
    };
    this.queues[safeType].push(entry);
    this.pending += 1;
    this.scheduleDrain();
    return { accepted: true, pending: this.pending };
  }

  evictLowerPriority(incomingType) {
    const incomingPriority = EVENT_PRIORITIES[incomingType] || 0;
    const candidates = ['CHAT', 'SHARE', 'MEMBER', 'FOLLOW']
      .filter((type) => (EVENT_PRIORITIES[type] || 0) < incomingPriority)
      .sort((a, b) => (EVENT_PRIORITIES[a] || 0) - (EVENT_PRIORITIES[b] || 0));
    for (const type of candidates) {
      if (this.queues[type].length) {
        this.queues[type].shift();
        this.pending -= 1;
        this.recordDropped(type, 1);
        return true;
      }
    }
    return false;
  }

  scheduleDrain() {
    if (this.stopped || this.processing || this.scheduled) return;
    this.scheduled = true;
    this.schedule(() => {
      this.scheduled = false;
      this.drainOnce().catch((err) => {
        this.stats.errors += 1;
        console.warn('[EventEngine] Drain failed:', err && err.message ? err.message : err);
      });
    });
  }

  nextQueue() {
    for (let step = 0; step < DRAIN_ROTATION.length; step += 1) {
      const index = (this.rotationCursor + step) % DRAIN_ROTATION.length;
      const type = DRAIN_ROTATION[index];
      if (this.queues[type] && this.queues[type].length) {
        this.rotationCursor = (index + 1) % DRAIN_ROTATION.length;
        return type;
      }
    }
    return null;
  }

  async drainOnce() {
    if (this.processing) return 0;
    this.processing = true;
    const started = Date.now();
    let processed = 0;
    try {
      while (!this.stopped && processed < this.batchSize && Date.now() - started < this.budgetMs) {
        const type = this.nextQueue();
        if (!type) break;
        const entry = this.queues[type].shift();
        this.pending -= 1;
        if (!entry || !this.handler) continue;
        try {
          await this.handler(entry);
          this.recordProcessed(type, 1);
        } catch (err) {
          this.recordError(type);
          this.recordDropped(type, 1);
          console.warn('[EventEngine] Handler error:', type, err && err.message ? err.message : err);
        }
        processed += 1;
      }
    } finally {
      this.processing = false;
      if (this.pending && !this.stopped) this.scheduleDrain();
    }
    return processed;
  }

  /** Useful in tests and shutdown paths: drain until empty or max events. */
  async drainAll(maxEvents = 100000) {
    let processed = 0;
    while (this.pending && processed < maxEvents) {
      const count = await this.drainOnce();
      processed += count;
      if (!count) break;
    }
    return processed;
  }

  getStats(nowValue) {
    const now = Number(nowValue) || Date.now();
    while (this.processedTimes.length && now - this.processedTimes[0] > 10000) this.processedTimes.shift();
    const pendingByType = {};
    for (const type of EVENT_TYPES) pendingByType[type] = this.queues[type].length;
    const filteredPerType = {};
    for (const type of EVENT_TYPES) {
      filteredPerType[type] = {
        ...this.stats.perType[type],
        pending: pendingByType[type]
      };
    }
    const ratePerSecond = this.processedTimes.length / Math.min(10, Math.max(1, (now - (this.processedTimes[0] || now)) / 1000 || 1));
    return {
      perType: filteredPerType,
      pendingByType,
      pending: this.pending,
      queueLimit: this.maxPending,
      limits: { ...this.limits },
      received: this.stats.received,
      processed: this.stats.processed,
      dropped: this.stats.dropped,
      duplicates: this.stats.duplicates,
      errors: this.stats.errors,
      receivedLikes: this.stats.receivedLikes,
      ratePerSecond: Math.round(ratePerSecond * 100) / 100,
      lastReceivedAt: this.stats.lastReceivedAt,
      lastProcessedAt: this.stats.lastProcessedAt,
      lastType: this.stats.lastType,
      processing: this.processing
    };
  }
}

module.exports = {
  EVENT_TYPES,
  EVENT_PRIORITIES,
  LIKE_WINDOWS,
  DEFAULT_LIKE_REACTIONS,
  GiftComboTracker,
  LikeBatcher,
  LiveEventEngine,
  normalizeLikeBatching,
  normalizeLikeReactions,
  clampInt,
  clampNumber
};
