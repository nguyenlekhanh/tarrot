/**
 * Mystic Witch Live — ambient Oracle conversation scheduler (stage only).
 *
 * The Oracle talks to the room even when nobody is watching, but never over
 * anything more important:
 *   tarot narration > gift reactions > viewer interactions > ambient dialogue
 *
 * Rules this scheduler enforces:
 * - one line at a time, and never queue a line behind speech already playing;
 * - ambient lines wait while the shared TTS queue is busy, so nothing overlaps;
 * - a tarot reading pauses ambient dialogue and it resumes shortly afterwards;
 * - the same line is not repeated until the recent pool has been used up;
 * - the server is the single source of truth for the catalog and settings.
 *
 * Speaking is delegated to the server (`conversation.speak`), which synthesizes
 * with the Oracle voice and broadcasts the existing `tts.play` message.
 */
(function () {
  const RECENT_LINES = 12;
  const RECENT_OPENINGS = 6;
  const DEFAULT_INTERVAL = 60;
  const MIN_INTERVAL = 20;
  const MAX_INTERVAL = 600;
  const READING_HOLD_MS = 20000;
  const PRIORITY_HOLD_MS = { gift: 12000, follow: 10000, viewer: 8000 };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value)));
  }

  function openingKey(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .slice(0, 5)
      .join(' ');
  }

  class MysticConversationEngine {
    constructor(options = {}) {
      this.speakLine = typeof options.speak === 'function' ? options.speak : null;
      this.isBusy = typeof options.isBusy === 'function' ? options.isBusy : () => false;
      this.onRecord = typeof options.onRecord === 'function' ? options.onRecord : null;
      this.onStatus = typeof options.onStatus === 'function' ? options.onStatus : null;
      this.getContext = typeof options.getContext === 'function' ? options.getContext : () => ({});
      this.settings = {
        enabled: true,
        running: true,
        aiDialogue: false,
        interval: DEFAULT_INTERVAL,
        shuffle: true,
        categories: {}
      };
      this.list = [];
      this.history = [];
      this.recentIds = [];
      this.recentOpenings = [];
      this.current = null;
      this.speaking = false;
      this.paused = false;
      this.reading = false;
      this.holdUntil = 0;
      this.holdReason = '';
      this.pendingViewer = null;
      this.nextAt = 0;
      this.initialized = false;
      this.lastReportAt = 0;
      this.lastError = '';
      this.timer = typeof setInterval === 'function' ? setInterval(() => this.tick(), 500) : null;
    }

    // ------------------------------------------------------------ server sync
    applySnapshot(snapshot) {
      if (!snapshot || !snapshot.settings) return false;
      const previous = this.settings;
      const wasOn = previous.enabled !== false && previous.running !== false;
      this.settings = {
        ...snapshot.settings,
        categories: { ...(snapshot.settings.categories || {}) }
      };
      if (Array.isArray(snapshot.list)) this.list = snapshot.list;
      if (Array.isArray(snapshot.history)) this.history = snapshot.history;
      const isOn = this.settings.enabled !== false && this.settings.running !== false;

      if (!this.initialized) {
        this.initialized = true;
        this.nextAt = Date.now() + this.intervalMs();
      } else if (isOn && !wasOn) {
        // Re-enabled from Admin: start a full interval instead of firing at once.
        this.nextAt = Date.now() + this.intervalMs();
        this.holdUntil = 0;
        this.holdReason = '';
      } else if (Number(previous.interval) !== Number(this.settings.interval) && !this.speaking) {
        this.nextAt = Date.now() + this.intervalMs();
      }
      this.report(true);
      return true;
    }

    intervalMs() {
      return clamp(Number(this.settings.interval) || DEFAULT_INTERVAL, MIN_INTERVAL, MAX_INTERVAL) * 1000;
    }

    setPaused(paused) {
      const next = Boolean(paused);
      if (next === this.paused) return;
      this.paused = next;
      this.holdReason = next ? 'shop paused' : '';
      this.nextAt = next ? 0 : Date.now() + this.intervalMs();
      this.report(true);
    }

    // ------------------------------------------------ higher-priority speech
    // Gift and viewer moments take the stage: ambient lines hold back, but a
    // line already playing is never cut off mid-sentence.
    notifyPriority(kind = 'viewer') {
      const hold = PRIORITY_HOLD_MS[kind] || PRIORITY_HOLD_MS.viewer;
      this.holdUntil = Math.max(this.holdUntil, Date.now() + hold);
      this.holdReason = kind;
      if (!this.speaking) this.nextAt = Math.max(this.nextAt || 0, this.holdUntil);
      this.report(true);
    }

    notifyGift() {
      this.notifyPriority('gift');
    }

    notifyFollow() {
      this.notifyPriority('follow');
    }

    notifyViewerJoin(name) {
      const clean = String(name || '').trim().slice(0, 40);
      if (clean) this.pendingViewer = { name: clean, at: Date.now() };
      this.notifyPriority('viewer');
    }

    // A tarot reading owns the voice. Ambient dialogue stops, and resumes on its
    // own a few seconds after the reading releases the stage.
    notifyReading(active, holdMs) {
      const next = Boolean(active);
      this.reading = next;
      if (next) {
        const hold = Number(holdMs) > 0 ? Number(holdMs) : READING_HOLD_MS;
        this.holdUntil = Math.max(this.holdUntil, Date.now() + hold);
        this.holdReason = 'reading';
      } else if (this.holdReason === 'reading') {
        this.holdReason = '';
        this.holdUntil = 0;
        this.nextAt = Math.max(Date.now() + 4000, this.holdUntil);
      }
      this.report(true);
    }

    // ------------------------------------------------------------- selection
    speechBusy() {
      try {
        return Boolean(this.isBusy());
      } catch (_) {
        return true;
      }
    }

    contexts() {
      const tags = new Set(['any']);
      let ctx = {};
      try {
        ctx = this.getContext() || {};
      } catch (_) {
        ctx = {};
      }
      const viewers = Number(ctx.viewers) || 0;
      const now = Date.now();
      if (viewers === 0) tags.add('empty');
      if (viewers <= 1) tags.add('quiet');
      if (this.pendingViewer && now - this.pendingViewer.at < 45000) tags.add('newViewer');
      if (this.holdReason === 'gift') tags.add('gift');
      if (this.holdReason === 'follow') tags.add('follower');
      return tags;
    }

    viewerLabel() {
      if (this.pendingViewer && Date.now() - this.pendingViewer.at < 45000) {
        return `@${this.pendingViewer.name}`;
      }
      return 'friend';
    }

    describe(text) {
      return String(text || '').replace(/\{viewer\}/gi, this.viewerLabel());
    }

    pickLine() {
      const tags = this.contexts();
      const categories = this.settings.categories || {};
      const pool = this.list.filter(
        (entry) => entry && entry.enabled !== false && entry.text && categories[entry.category] !== false
      );
      if (!pool.length) return null;

      const contextual = pool.filter((entry) => {
        const contexts = Array.isArray(entry.contexts) && entry.contexts.length ? entry.contexts : ['any'];
        return contexts.includes('any') || contexts.some((context) => tags.has(context));
      });
      const usable = contextual.length ? contextual : pool;

      const recent = new Set(this.recentIds.slice(0, RECENT_LINES));
      const openings = new Set(this.recentOpenings.slice(0, RECENT_OPENINGS));
      let fresh = usable.filter((entry) => !recent.has(entry.id));
      if (!fresh.length) fresh = usable.filter((entry) => !this.current || entry.id !== this.current.id);
      if (!fresh.length) fresh = usable;

      let varied = fresh.filter((entry) => !openings.has(openingKey(entry.text)));
      if (!varied.length) varied = fresh;

      if (!varied.length) return null;
      if (this.settings.shuffle === false) {
        const lastId = this.recentIds[0] || '';
        const ordered = this.list.filter((entry) => entry.enabled !== false);
        const lastIndex = ordered.findIndex((entry) => entry.id === lastId);
        for (let step = 1; step <= ordered.length; step += 1) {
          const candidate = ordered[(lastIndex + step + ordered.length) % ordered.length];
          if (varied.some((entry) => entry.id === candidate.id)) return candidate;
        }
      }
      return varied[Math.floor(Math.random() * varied.length)];
    }

    // ------------------------------------------------------------- speaking
    startLine(entry) {
      if (!entry || this.speaking) return false;
      if (this.settings.enabled === false || this.settings.running === false || this.paused) return false;
      this.speaking = true;
      this.current = entry;
      this.holdReason = '';
      this.lastError = '';
      this.report(true);

      const finish = (status, error) => {
        if (this.current !== entry) return;
        this.speaking = false;
        this.current = null;
        this.nextAt = Date.now() + this.intervalMs();
        this.recentIds = [entry.id, ...this.recentIds.filter((id) => id !== entry.id)].slice(0, RECENT_LINES);
        this.recentOpenings = [openingKey(entry.text), ...this.recentOpenings].slice(0, 8);
        this.lastError = error || '';
        if (this.onRecord) {
          this.onRecord({
            conversationId: entry.id,
            category: entry.category,
            status,
            text: this.describe(entry.text),
            error: error || ''
          });
        }
        this.report(true);
      };

      let result;
      try {
        result = this.speakLine(entry, this.describe(entry.text));
      } catch (err) {
        finish('failed', err && err.message ? err.message : 'speak failed');
        return true;
      }
      Promise.resolve(result)
        .then((response) => {
          const ok = response !== false && (!response || response.ok !== false);
          finish(ok ? 'spoken' : 'failed', ok ? '' : (response && response.error) || 'speech unavailable');
        })
        .catch((err) => finish('failed', err && err.message ? err.message : 'speak failed'));
      return true;
    }

    tick() {
      if (!this.speakLine) return false;
      if (this.settings.enabled === false || this.settings.running === false || this.paused) return false;
      if (this.speaking) return false;
      // A reading, a gift line or a viewer reply is playing: say nothing.
      if (this.reading) return false;
      if (this.speechBusy()) return false;
      const now = Date.now();
      if (this.holdUntil && now < this.holdUntil) return false;
      if (now < (this.nextAt || 0)) return false;

      const entry = this.pickLine();
      if (!entry) {
        this.lastError = 'no dialogue matches this context';
        this.nextAt = now + this.intervalMs();
        this.report(true);
        return false;
      }
      return this.startLine(entry);
    }

    stop() {
      if (this.timer && typeof clearInterval === 'function') clearInterval(this.timer);
      this.timer = null;
    }

    // ---------------------------------------------------------------- status
    status() {
      const enabled = this.settings.enabled !== false;
      const running = this.settings.running !== false;
      const phase = !enabled || !running
        ? 'idle'
        : this.reading
          ? 'reading'
          : this.paused
            ? 'paused'
            : this.speaking
              ? 'speaking'
              : 'scheduled';
      return {
        status: !enabled || !running ? 'disabled' : this.paused ? 'paused' : this.speaking ? 'speaking' : 'scheduled',
        phase,
        currentId: this.current ? this.current.id : '',
        category: this.current ? this.current.category : '',
        nextAt: this.speaking ? null : this.nextAt || null,
        reading: this.reading,
        holdUntil: this.holdUntil || 0,
        reason: this.lastError,
        aiDialogue: this.settings.aiDialogue === true,
        interval: this.settings.interval,
        enabled,
        running,
        queue: this.speechBusy() ? 1 : 0,
        recent: this.recentIds.slice(0, 10)
      };
    }

    report(force = false) {
      if (!this.onStatus) return;
      const now = Date.now();
      if (!force && now - this.lastReportAt < 500) return;
      this.lastReportAt = now;
      this.onStatus(this.status());
    }
  }

  window.MysticConversationEngine = MysticConversationEngine;
})();
