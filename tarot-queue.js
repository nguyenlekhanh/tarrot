'use strict';

/**
 * Mystic Witch Live — live tarot queue.
 *
 * Pure, clock-injected and deterministic, so promotions and positions can be
 * unit-tested without a live stream. Nothing here renders: it produces positions
 * and ready-to-display movement messages that the server broadcasts.
 *
 * Ordering: higher score first, then the earlier arrival (FIFO). Score comes from
 * gift / like / manual boosts plus waiting credits, so a viewer who waits can
 * climb above a fresher arrival without any gift.
 */

const MAX_NAME = 40;
const MAX_TOPIC = 60;

const MOVEMENT_TEXT = {
  gift: { icon: '🎁', queue: 'SENT A GIFT! MOVED UP', ticker: 'SENT A GIFT!' },
  like: { icon: '💗', queue: 'SENT LOTS OF LOVE! MOVED UP', ticker: 'IS SENDING LOTS OF LOVE!' },
  wait: { icon: '🌹', queue: 'MOVED UP', ticker: 'MOVED UP' },
  manual: { icon: '✨', queue: 'MOVED UP', ticker: 'MOVED UP' }
};

function clampInt(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function cleanName(value) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME);
}

function cleanTopic(value) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TOPIC);
}

function viewerKey(user, uniqueId) {
  const id = String(uniqueId || '').trim().toLowerCase();
  if (id) return `u:${id.slice(0, 60)}`;
  const name = cleanName(user).toLowerCase();
  return name ? `n:${name}` : '';
}

/** "🎁 EMILY SENT A GIFT! MOVED UP: #77 → #71" / ticker variant. */
function formatMovement(kind, user, from, to, options = {}) {
  const style = MOVEMENT_TEXT[kind] || MOVEMENT_TEXT.manual;
  const name = cleanName(user).toUpperCase() || 'A SEEKER';
  const action = options.ticker === true ? style.ticker : style.queue;
  const suffix = options.ticker === true ? ` #${from} → #${to}` : `: #${from} → #${to}`;
  return `${style.icon} ${name} ${action}${suffix}`;
}

class TarotQueue {
  constructor(options = {}) {
    this.now = typeof options.now === 'function' ? options.now : () => Date.now();
    this.capacity = clampInt(options.capacity, 100, 1, 1000);
    this.waitIntervalMs = clampInt(options.waitIntervalSeconds, 90, 10, 3600) * 1000;
    this.waitAmount = Math.max(0, Number(options.waitAmount) || 1);
    this.entries = [];
    this.seq = 0;
    this.served = 0;
    this.dropped = 0;
    this.recent = [];
    this.giftGroups = new Set();
    this.current = null;
    if (Array.isArray(options.entries)) this.hydrate(options.entries, options.seq);
  }

  hydrate(entries, seq) {
    this.entries = [];
    this.seq = clampInt(seq, 0, 0, 1000000);
    for (const raw of entries) {
      const key = viewerKey(raw && raw.user, raw && raw.uniqueId);
      if (!key) continue;
      this.seq += 1;
      this.entries.push({
        id: String(raw.id || `q_${this.seq}`),
        key,
        user: cleanName(raw.user),
        uniqueId: String(raw.uniqueId || '').slice(0, 60),
        avatar: String(raw.avatar || '').slice(0, 400),
        topicId: String(raw.topicId || '').slice(0, 60),
        topicLabel: cleanTopic(raw.topicLabel),
        question: String(raw.question || '').slice(0, 200),
        spread: raw.spread === 'one' ? 'one' : 'three',
        boost: Math.max(0, Number(raw.boost) || 0),
        waitSteps: Math.max(0, Number(raw.waitSteps) || 0),
        joinedAt: Number(raw.joinedAt) || this.now(),
        seq: this.seq,
        promotions: Array.isArray(raw.promotions) ? raw.promotions.slice(-8) : []
      });
    }
    if (this.entries.length > this.capacity) this.entries.length = 0;
  }

  setCapacity(capacity) {
    this.capacity = clampInt(capacity, this.capacity, 1, 1000);
    const dropped = [];
    while (this.entries.length > this.capacity) {
      const ordered = this.ordered();
      const last = ordered[ordered.length - 1];
      if (!last) break;
      dropped.push({ user: last.entry.user, position: last.position });
      this.entries = this.entries.filter((entry) => entry.key !== last.entry.key);
      this.dropped += 1;
    }
    return { capacity: this.capacity, dropped };
  }

  setWaitRule(seconds, amount) {
    this.waitIntervalMs = clampInt(seconds, this.waitIntervalMs / 1000, 10, 3600) * 1000;
    if (amount !== undefined) this.waitAmount = Math.max(0, Number(amount) || 0);
  }

  scoreOf(entry) {
    return Math.max(0, entry.boost + entry.waitSteps * this.waitAmount);
  }

  /** Ordered view: score desc, then arrival order. */
  ordered() {
    return [...this.entries]
      .sort((a, b) => {
        const diff = this.scoreOf(b) - this.scoreOf(a);
        if (diff !== 0) return diff;
        return a.seq - b.seq;
      })
      .map((entry, index) => ({ entry, position: index + 1, score: this.scoreOf(entry) }));
  }

  positions() {
    const map = new Map();
    for (const item of this.ordered()) map.set(item.entry.key, item.position);
    return map;
  }

  find(keyOrUser) {
    const raw = String(keyOrUser || '').trim();
    if (!raw) return null;
    const byKey = this.entries.find((entry) => entry.key === raw);
    if (byKey) return byKey;
    const lower = raw.toLowerCase();
    return (
      this.entries.find((entry) => entry.id === raw) ||
      this.entries.find((entry) => entry.user.toLowerCase() === lower) ||
      this.entries.find((entry) => entry.uniqueId && entry.uniqueId.toLowerCase() === lower) ||
      null
    );
  }

  positionOf(keyOrUser) {
    const entry = this.find(keyOrUser);
    if (!entry) return 0;
    return this.positions().get(entry.key) || 0;
  }

  add(params = {}) {
    const key = viewerKey(params.user, params.uniqueId);
    const user = cleanName(params.user);
    if (!key || !user) return { ok: false, reason: 'missing_viewer' };
    const existing = this.find(key);
    if (existing) {
      return { ok: true, duplicate: true, entry: existing, position: this.positionOf(key) };
    }
    if (this.entries.length >= this.capacity) {
      this.dropped += 1;
      return { ok: false, reason: 'queue_full', capacity: this.capacity };
    }
    this.seq += 1;
    const entry = {
      id: `q_${this.now()}_${this.seq}`,
      key,
      user,
      uniqueId: String(params.uniqueId || '').slice(0, 60),
      avatar: String(params.avatar || '').slice(0, 400),
      topicId: String(params.topicId || '').slice(0, 60),
      topicLabel: cleanTopic(params.topicLabel),
      question: String(params.question || '').slice(0, 200),
      spread: params.spread === 'one' ? 'one' : 'three',
      boost: Math.max(0, Number(params.boost) || 0),
      waitSteps: 0,
      joinedAt: this.now(),
      seq: this.seq,
      promotions: []
    };
    this.entries.push(entry);
    return { ok: true, duplicate: false, entry, position: this.positionOf(key) };
  }

  remove(keyOrUser) {
    const entry = this.find(keyOrUser);
    if (!entry) return { ok: false, reason: 'not_in_queue' };
    const position = this.positionOf(keyOrUser);
    this.entries = this.entries.filter((item) => item.key !== entry.key);
    if (this.current && this.current.key === entry.key) this.current = null;
    return { ok: true, removed: { user: entry.user, position } };
  }

  clear() {
    const count = this.entries.length;
    this.entries = [];
    this.current = null;
    return { ok: true, cleared: count };
  }

  record(kind, entry, from, to, meta = {}) {
    const movement = {
      id: `mv_${this.now()}_${this.recent.length + 1}`,
      kind,
      user: entry.user,
      uniqueId: entry.uniqueId,
      from,
      to,
      at: this.now(),
      giftId: meta.giftId || '',
      giftName: meta.giftName || '',
      giftIcon: meta.giftIcon || '',
      message: formatMovement(kind, entry.user, from, to),
      ticker: formatMovement(kind, entry.user, from, to, { ticker: true })
    };
    entry.promotions = [...(entry.promotions || []), { kind, from, to, at: movement.at }].slice(-8);
    this.recent = [movement, ...this.recent].slice(0, 12);
    return movement;
  }

  /** Move one viewer up; records a movement only when the position improves. */
  promote(keyOrUser, amount, kind = 'manual', meta = {}) {
    const entry = this.find(keyOrUser);
    if (!entry) return { ok: false, reason: 'not_in_queue' };
    const from = this.positionOf(entry.key);
    const points = Math.max(0, Number(amount) || 0);
    if (!points) return { ok: true, moved: false, from, to: from, entry };
    entry.boost += points;
    const to = this.positionOf(entry.key);
    const moved = to < from;
    const movement = moved ? this.record(kind, entry, from, to, meta) : null;
    return { ok: true, moved, from, to, entry, movement };
  }

  /**
   * Gift promotion with combo deduplication: one gift group can promote once,
   * even if TikTok delivers several repeats of the same group.
   */
  promoteGift(params = {}) {
    const entry = this.find(params.key || params.user || params.uniqueId);
    if (!entry) return { ok: false, reason: 'not_in_queue' };
    const groupKey = String(params.groupId || `${entry.key}:${params.giftId || 'gift'}:${params.giftName || ''}`);
    if (this.giftGroups.has(groupKey)) return { ok: false, reason: 'duplicate_gift_group' };
    this.giftGroups.add(groupKey);
    while (this.giftGroups.size > 2000) {
      this.giftGroups.delete(this.giftGroups.values().next().value);
    }
    const mapping = Array.isArray(params.mapping) ? params.mapping : [];
    const giftId = String(params.giftId || '').toLowerCase();
    const giftName = String(params.giftName || '').toLowerCase();
    const match = mapping.find((item) => {
      const id = String(item.id || '').toLowerCase();
      const name = String(item.name || '').toLowerCase();
      const aliases = (Array.isArray(item.aliases) ? item.aliases : []).map((alias) => String(alias).toLowerCase());
      return (
        (id && (id === giftId || id === giftName)) ||
        (name && (name === giftName || name === giftId)) ||
        (giftName && aliases.includes(giftName)) ||
        (giftId && aliases.includes(giftId))
      );
    });
    const coins = Math.max(0, Number(params.coins) || 0);
    const amount = match
      ? Math.max(0, Number(match.promote) || 0)
      : Math.floor(coins / Math.max(1, Number(params.coinsPerStep) || 5));
    return this.promote(entry.key, amount, 'gift', {
      giftId: params.giftId,
      giftName: params.giftName,
      giftIcon: params.giftIcon || (match && match.icon) || ''
    });
  }

  /** Accrue waiting credits; returns movements only for viewers who climbed. */
  accrueWait(nowValue) {
    const now = Number(nowValue) || this.now();
    const before = this.positions();
    let changed = false;
    for (const entry of this.entries) {
      const due = Math.floor(Math.max(0, now - entry.joinedAt) / this.waitIntervalMs);
      if (due > entry.waitSteps) {
        entry.waitSteps = due;
        changed = true;
      }
    }
    if (!changed) return [];
    const after = this.positions();
    const movements = [];
    for (const entry of this.entries) {
      const from = before.get(entry.key) || 0;
      const to = after.get(entry.key) || 0;
      if (from && to && to < from) movements.push(this.record('wait', entry, from, to));
    }
    return movements;
  }

  /** Promote a viewer after a like burst, once per batch. */
  promoteLike(params = {}) {
    return this.promote(params.key || params.user, params.amount, 'like');
  }

  /** Take the head of the queue as the current reading. */
  startNext() {
    const ordered = this.ordered();
    if (!ordered.length) return null;
    const entry = ordered[0].entry;
    this.entries = this.entries.filter((item) => item.key !== entry.key);
    this.current = { ...entry, startedAt: this.now() };
    return this.current;
  }

  complete(keyOrUser) {
    if (this.current && (!keyOrUser || this.current.key === viewerKey(keyOrUser.user, keyOrUser.uniqueId) || this.current.key === keyOrUser)) {
      this.current = null;
      this.served += 1;
      return true;
    }
    return false;
  }

  snapshot() {
    const ordered = this.ordered();
    const nextNames = ordered.slice(0, 2).map((item) => item.entry.user);
    return {
      capacity: this.capacity,
      count: this.entries.length,
      total: this.entries.length,
      current: this.current
        ? {
            user: this.current.user,
            uniqueId: this.current.uniqueId,
            topicLabel: this.current.topicLabel,
            question: this.current.question,
            startedAt: this.current.startedAt || null
          }
        : null,
      next: nextNames,
      lines: {
        current: this.current ? `NOW READING: ${this.current.user.toUpperCase()}` : 'THE READING TABLE IS WAITING',
        next: nextNames.length ? `NEXT: ${nextNames.map((name) => name.toUpperCase()).join(' → ')}` : 'NEXT: THE LINE IS OPEN',
        recent: this.recent[0] ? this.recent[0].message : '',
        count: `${this.entries.length} / ${this.capacity} WAITING`
      },
      entries: ordered.slice(0, 50).map((item) => ({
        position: item.position,
        user: item.entry.user,
        uniqueId: item.entry.uniqueId,
        topicLabel: item.entry.topicLabel,
        score: item.score,
        joinedAt: item.entry.joinedAt
      })),
      recent: this.recent.slice(0, 6),
      served: this.served,
      dropped: this.dropped,
      waitIntervalSeconds: Math.round(this.waitIntervalMs / 1000)
    };
  }

  toJSON() {
    return {
      capacity: this.capacity,
      seq: this.seq,
      waitIntervalSeconds: Math.round(this.waitIntervalMs / 1000),
      waitAmount: this.waitAmount,
      served: this.served,
      dropped: this.dropped,
      current: this.current,
      entries: this.entries.map((entry) => ({ ...entry }))
    };
  }
}

module.exports = {
  TarotQueue,
  viewerKey,
  formatMovement,
  cleanName,
  MOVEMENT_TEXT
};
