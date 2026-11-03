/**
 * Mystic Witch Live — seller conversation scheduler (stage only).
 *
 * Two sellers, two real Piper profiles, one shared speech queue:
 * - Schedules one line at a time, never an entire conversation.
 * - Waits for the previous sentence to finish, then adds a natural pause.
 * - Priority 2 automatic speech: gifts/VIP/viewer replies always go first.
 * - Pauses with the shop, notifies the server for the Admin panel, and never
 *   creates a second scheduler when more Admin tabs are open.
 */
(function () {
  const RECENT_CONVERSATIONS = 10;
  const RECENT_OPENINGS = 6;
  const LINE_PAUSE_MIN = 650;
  const LINE_PAUSE_MAX = 1150;

  function clone(value) {
    if (!value || typeof value !== 'object') return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_) {
      return null;
    }
  }

  function openingKey(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .slice(0, 4)
      .join(' ');
  }

  class ShopConversationEngine {
    constructor(options = {}) {
      this.audio = options.audio || null;
      this.announcer = options.announcer || null;
      this.getContext = typeof options.getContext === 'function' ? options.getContext : () => ({});
      this.settings = {
        enabled: true,
        running: true,
        interval: 30,
        shuffle: true,
        categories: {}
      };
      this.list = [];
      this.history = [];
      this.voiceProfiles = null;
      this.paused = false;
      this.sequence = null;
      this.pendingBigGift = null;
      this.pendingViewer = null;
      this.lastGiftAt = 0;
      this.lastServedAt = 0;
      this.lastEndedAt = 0;
      this.nextAt = Date.now() + 30000;
      this.suspendedUntil = 0;
      this.recentIds = [];
      this.recentOpenings = [];
      this.reason = '';
      this.initialized = false;
      this.lastReportAt = 0;
      this.lastReportedNextAt = 0;
      this.timer = setInterval(() => this.tick(), 500);
    }

    // ------------------------------------------------------------- server sync
    applySnapshot(snapshot) {
      if (!snapshot || !snapshot.settings) return;
      const previousInterval = Number(this.settings.interval) || 30;
      const wasEnabled = this.settings.enabled !== false && this.settings.running !== false;
      this.settings = {
        ...snapshot.settings,
        categories: { ...(snapshot.settings.categories || {}) }
      };
      if (Array.isArray(snapshot.list)) this.list = snapshot.list;
      if (Array.isArray(snapshot.history)) this.history = snapshot.history;
      for (const entry of this.history) {
        if (entry && entry.conversationId && !this.recentIds.includes(entry.conversationId)) {
          this.recentIds.push(entry.conversationId);
        }
      }
      this.recentIds = this.recentIds.slice(0, 12);

      const enabledNow = this.settings.enabled !== false && this.settings.running !== false;
      if (!this.initialized) {
        this.initialized = true;
        this.nextAt = Date.now() + this.intervalMs();
      } else if (enabledNow && !wasEnabled) {
        // Restarted from the Admin panel: start a fresh interval, not instantly.
        this.nextAt = Date.now() + this.intervalMs();
        this.suspendedUntil = 0;
      }
      if (previousInterval !== this.settings.interval && !this.sequence) {
        this.nextAt = Date.now() + this.intervalMs();
      }
      if (!enabledNow && this.sequence) this.abort('disabled', 'interrupted');
      this.reportStatus(false);
    }

    setVoiceProfiles(snapshot) {
      if (snapshot && snapshot.profiles) this.voiceProfiles = snapshot;
    }

    intervalMs() {
      return Math.max(20, Number(this.settings.interval) || 30) * 1000;
    }

    setPaused(paused) {
      const next = Boolean(paused);
      if (next === this.paused) return;
      this.paused = next;
      if (next) {
        if (this.sequence) this.abort('paused', 'interrupted');
        this.nextAt = 0;
      } else {
        this.nextAt = Date.now() + this.intervalMs();
        this.suspendedUntil = 0;
      }
      this.reportStatus(true);
    }

    // -------------------------------------------------------- event awareness
    notifyPriority(kind = 'viewer') {
      if (!this.settings.enabled || !this.settings.running) return;
      const holdMs = kind === 'gift' ? 10000 : kind === 'vip' ? 9000 : 7000;
      this.suspendedUntil = Math.max(this.suspendedUntil, Date.now() + holdMs);
      this.lastGiftAt = kind === 'gift' || kind === 'vip' ? Date.now() : this.lastGiftAt;
      if (this.sequence) this.abort('priority event', 'interrupted');
      if (!this.paused) this.nextAt = Math.max(this.nextAt || 0, this.suspendedUntil);
      this.reportStatus(true);
    }

    notifyGift(ev = {}) {
      const tier = ev && ev.celebration ? ev.celebration.tier : 'none';
      this.notifyPriority('gift');
      if (['gold', 'fireworks', 'grand'].includes(tier)) {
        this.pendingBigGift = {
          at: Date.now(),
          user: String(ev.user || '').trim().slice(0, 40),
          tier
        };
      }
    }

    notifyViewerJoin(name) {
      const clean = String(name || '').trim().slice(0, 40);
      if (!clean) return;
      this.pendingViewer = { name: clean, at: Date.now() };
    }

    notifyServed() {
      this.lastServedAt = Date.now();
    }

    // ------------------------------------------------------------- selection
    isExchangeUsable(entry) {
      if (!entry || entry.enabled === false) return false;
      if (!entry.male || !entry.female) return false;
      if (this.settings.categories && this.settings.categories[entry.category] === false) return false;
      return true;
    }

    activeContexts() {
      const tags = new Set(['any']);
      let ctx = {};
      try {
        ctx = this.getContext() || {};
      } catch (_) {
        ctx = {};
      }
      const stats = ctx.stats || {};
      const customers = Number(stats.customers) || 0;
      const waiting = Number(stats.waiting) || 0;
      const viewers = Number(ctx.viewers) || 0;
      const now = Date.now();
      if (viewers === 0 && customers === 0) tags.add('empty');
      if (viewers <= 1 && customers <= 1) tags.add('quiet');
      if (waiting >= 2 || customers >= 4) tags.add('busy');
      if (this.pendingViewer && now - this.pendingViewer.at < 30000) tags.add('newViewer');
      if (this.lastGiftAt && now - this.lastGiftAt < 90000) {
        tags.add('gift');
        tags.add('supporter');
      }
      const day = new Date().getDay();
      if (day === 0 || day === 6) tags.add('weekend');
      return tags;
    }

    preferredCategories(tags) {
      if (tags.has('busy')) return ['busy', 'daily', 'drinks', 'menu', 'atmosphere'];
      if (tags.has('newViewer')) return ['greetings', 'daily', 'drinks', 'menu'];
      if (tags.has('empty')) return ['greetings', 'quiet', 'menu', 'weather', 'daily', 'atmosphere'];
      if (tags.has('quiet')) return ['quiet', 'greetings', 'daily', 'drinks', 'atmosphere'];
      if (tags.has('gift')) return ['supporter', 'drinks', 'daily', 'atmosphere'];
      return ['daily', 'drinks', 'menu', 'funny', 'teasing', 'weather', 'weekend', 'atmosphere', 'supporter'];
    }

    viewerLabel(explicit) {
      if (explicit) return `@${explicit}`;
      if (this.pendingViewer && Date.now() - this.pendingViewer.at < 45000) {
        return `@${this.pendingViewer.name}`;
      }
      return 'everybody';
    }

    pickExchange(options = {}) {
      const tags = this.activeContexts();
      const preferred = this.preferredCategories(tags);
      const requireBigGift = options.bigGift === true;
      let pool = this.list.filter((entry) => this.isExchangeUsable(entry));
      pool = pool.filter((entry) => {
        const contexts = Array.isArray(entry.contexts) && entry.contexts.length ? entry.contexts : ['any'];
        if (requireBigGift) return contexts.includes('bigGift');
        return contexts.includes('any') || contexts.some((context) => tags.has(context));
      });

      const recent = new Set(this.recentIds.slice(0, RECENT_CONVERSATIONS));
      const lastId = this.recentIds[0] || '';
      let fresh = pool.filter((entry) => !recent.has(entry.id));
      if (!fresh.length) fresh = pool.filter((entry) => entry.id !== lastId);
      if (!fresh.length) fresh = pool;

      const openings = new Set(this.recentOpenings.slice(0, RECENT_OPENINGS));
      let varied = fresh.filter((entry) => !openings.has(openingKey(entry.male)));
      if (!varied.length) varied = fresh;

      if (!varied.length) return null;
      if (this.settings.shuffle === false) {
        const ordered = this.list.filter((entry) => entry.enabled !== false);
        const lastIndex = ordered.findIndex((entry) => entry.id === lastId);
        for (let step = 1; step <= ordered.length; step += 1) {
          const candidate = ordered[(lastIndex + step) % ordered.length];
          if (varied.some((entry) => entry.id === candidate.id)) return candidate;
        }
      }

      // Weighted random: context-matching categories appear more often, while
      // casual categories still keep the shop from sounding like a sales script.
      const weighted = [];
      for (const entry of varied) {
        weighted.push(entry);
        if (preferred.includes(entry.category)) weighted.push(entry, entry);
        if (tags.has('newViewer') && entry.category === 'greetings') weighted.push(entry, entry);
        if (tags.has('gift') && entry.category === 'supporter') weighted.push(entry);
      }
      return weighted[Math.floor(Math.random() * weighted.length)] || null;
    }

    // ------------------------------------------------------------- speaking
    canSpeak() {
      const profiles = this.voiceProfiles && this.voiceProfiles.profiles;
      if (!profiles) return { ok: false, reason: 'Waiting for voice profiles' };
      for (const id of ['maleSeller', 'femaleSeller']) {
        const profile = profiles[id];
        if (!profile || profile.enabled === false) {
          return { ok: false, reason: `${id === 'maleSeller' ? 'Male' : 'Female'} Seller profile disabled` };
        }
        if (!(profile.resolvedVoice || profile.voice || profile.kokoroVoice)) {
          return { ok: false, reason: `${id === 'maleSeller' ? 'Male' : 'Female'} Seller has no TTS voice` };
        }
      }
      return { ok: true };
    }

    speechBusy() {
      if (!this.audio) return true;
      return Boolean(this.audio.ttsPlaying) || (Array.isArray(this.audio.ttsQueue) && this.audio.ttsQueue.length > 0);
    }

    lineText(text, explicitViewer) {
      return String(text || '').replace(/\{viewer\}/gi, this.viewerLabel(explicitViewer));
    }

    startExchange(entry, reason, explicitViewer) {
      if (!entry || this.sequence || this.paused) return false;
      if (!this.settings.enabled || !this.settings.running) return false;
      const ability = this.canSpeak();
      if (!ability.ok) {
        this.reason = ability.reason;
        this.reportStatus(true);
        return false;
      }
      if (this.speechBusy()) return false;

      const lines = [{ speaker: 'maleSeller', text: this.lineText(entry.male, explicitViewer) }];
      lines.push({ speaker: 'femaleSeller', text: this.lineText(entry.female, explicitViewer) });
      if (entry.followUp) {
        lines.push({ speaker: 'maleSeller', text: this.lineText(entry.followUp, explicitViewer) });
      }
      if (entry.category === 'greetings') this.pendingViewer = null;
      const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      this.sequence = {
        runId,
        entry,
        lines,
        spoken: [],
        index: 0,
        phase: 'waiting',
        nextLineAt: 0,
        startedAt: new Date().toISOString(),
        explicitViewer: explicitViewer || '',
        reason
      };
      this.reason = '';
      this.recentIds.unshift(entry.id);
      this.recentIds = [...new Set(this.recentIds)].slice(0, 12);
      this.recentOpenings.unshift(openingKey(entry.male));
      this.recentOpenings = this.recentOpenings.slice(0, 8);

      if (this.announcer && typeof this.announcer.setConversationActive === 'function') {
        this.announcer.setConversationActive(true);
      }
      this.recordRun('started');
      this.reportStatus(true);
      this.speakNext();
      return true;
    }

    speakNext() {
      const seq = this.sequence;
      if (!seq) return;
      if (this.paused || !this.settings.enabled || !this.settings.running) {
        this.abort('paused', 'interrupted');
        return;
      }
      if (Date.now() < seq.nextLineAt) return;
      if (seq.index >= seq.lines.length) {
        this.finish('completed');
        return;
      }
      if (this.speechBusy()) return;

      const line = seq.lines[seq.index];
      const profiles = (this.voiceProfiles && this.voiceProfiles.profiles) || {};
      const profile = profiles[line.speaker];
      if (!profile || profile.enabled === false) {
        this.abort('seller profile disabled', 'interrupted');
        return;
      }
      const engine = profile.resolvedEngine === 'kokoro' || profile.engine === 'kokoro' ? 'kokoro' : 'piper';
      const voice = engine === 'kokoro' ? profile.resolvedVoice || profile.kokoroVoice : profile.resolvedVoice || profile.voice;
      if (!voice) {
        this.abort(`missing ${engine === 'kokoro' ? 'Kokoro' : 'Piper'} voice`, 'interrupted');
        return;
      }

      seq.phase = line.speaker === 'femaleSeller' ? 'female' : seq.index === 0 ? 'male' : 'followUp';
      this.reportStatus(true);
      const ok = this.audio.enqueueTts(line.text, {
        priority: 2,
        engine,
        language: profile.language === 'vi' ? 'vi' : 'en',
        voice,
        piperVoice: profile.piperFallbackVoice || profile.voice,
        speed: Number(profile.speed) || 1,
        volume: profile.volume,
        profile: line.speaker,
        onStart: () => {
          if (this.sequence !== seq) return;
          if (!seq.spoken.some((spoken) => spoken.text === line.text && spoken.speaker === line.speaker)) {
            seq.spoken.push({ speaker: line.speaker, text: line.text });
          }
          this.reportStatus(true);
        },
        onEnd: () => {
          if (this.sequence !== seq) return;
          seq.index += 1;
          seq.phase = 'waiting';
          seq.nextLineAt = Date.now() + LINE_PAUSE_MIN + Math.random() * (LINE_PAUSE_MAX - LINE_PAUSE_MIN);
          this.reportStatus(true);
        }
      });
      if (ok === false) {
        // Automatic chatter never queues. Try again on the next tick.
        seq.nextLineAt = Date.now() + 700;
      }
    }

    finish(status = 'completed') {
      const seq = this.sequence;
      if (!seq) return;
      this.sequence = null;
      this.lastEndedAt = Date.now();
      this.nextAt = Date.now() + this.intervalMs();
      this.suspendedUntil = 0;
      if (this.announcer && typeof this.announcer.setConversationActive === 'function') {
        this.announcer.setConversationActive(false);
      }
      this.recordRun(status, seq);
      this.reportStatus(true);
    }

    abort(reason, status = 'interrupted') {
      const seq = this.sequence;
      if (!seq) return;
      this.sequence = null;
      this.reason = reason;
      this.lastEndedAt = Date.now();
      if (this.paused) this.nextAt = 0;
      else if (reason === 'priority event') this.nextAt = Math.max(Date.now() + 7000, this.suspendedUntil || 0);
      else this.nextAt = Date.now() + this.intervalMs();
      if (this.announcer && typeof this.announcer.setConversationActive === 'function') {
        this.announcer.setConversationActive(false);
      }
      this.recordRun(status, seq);
      this.reportStatus(true);
    }

    // --------------------------------------------------------------- ticking
    tick() {
      if (!this.audio) return;
      if (!this.settings.enabled || !this.settings.running || this.paused) return;

      const ability = this.canSpeak();
      if (!ability.ok) {
        if (this.reason !== ability.reason) {
          this.reason = ability.reason;
          this.reportStatus(true);
        }
        return;
      }
      if (this.reason === 'Waiting for voice profiles') this.reason = '';

      if (this.sequence) {
        this.speakNext();
        return;
      }
      if (this.speechBusy()) return;
      if (this.suspendedUntil && Date.now() < this.suspendedUntil) return;

      // Large gifts trigger a special joint reaction after the gift thank-you.
      if (this.pendingBigGift && Date.now() - this.pendingBigGift.at >= 3500) {
        if (Date.now() - this.pendingBigGift.at < 30000) {
          const entry = this.pickExchange({ bigGift: true });
          const user = this.pendingBigGift.user;
          this.pendingBigGift = null;
          if (entry && this.startExchange(entry, 'bigGift', user)) return;
        } else {
          this.pendingBigGift = null;
        }
      }

      if (Date.now() < this.nextAt) return;
      const entry = this.pickExchange();
      if (!entry) {
        this.reason = 'No enabled conversation matches this context';
        this.nextAt = Date.now() + this.intervalMs();
        this.reportStatus(true);
        return;
      }
      this.startExchange(entry, 'interval');
    }

    // ------------------------------------------------------ reporting to server
    status() {
      return {
        enabled: this.settings.enabled !== false,
        running: this.settings.running !== false,
        paused: this.paused,
        interval: this.settings.interval,
        nextAt: this.sequence ? null : this.nextAt || null,
        currentSpeaker: this.sequence ? this.sequence.phase : '',
        conversationId: this.sequence ? this.sequence.entry.id : '',
        category: this.sequence ? this.sequence.entry.category : '',
        phase: this.sequence ? this.sequence.phase : this.paused ? 'paused' : 'idle',
        queue: this.audio && Array.isArray(this.audio.ttsQueue) ? this.audio.ttsQueue.length : 0,
        reason: this.reason,
        recent: [...this.recentIds.slice(0, 10)]
      };
    }

    reportStatus(force = false) {
      const now = Date.now();
      if (!force && now - this.lastReportAt < 500) return;
      this.lastReportAt = now;
      const status = this.status();
      this.lastReportedNextAt = status.nextAt || 0;
      fetch('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'conversation.status',
          params: {
            status: !this.settings.enabled ? 'disabled' : this.paused ? 'paused' : this.sequence ? 'speaking' : 'scheduled',
            currentSpeaker: status.currentSpeaker === 'male' || status.currentSpeaker === 'female' || status.currentSpeaker === 'followUp' ? (status.currentSpeaker === 'female' ? 'femaleSeller' : 'maleSeller') : '',
            conversationId: status.conversationId,
            category: status.category,
            phase: ['waiting', 'male', 'female', 'followUp', 'paused'].includes(status.phase) ? status.phase : 'idle',
            nextAt: status.nextAt,
            queue: status.queue,
            reason: status.reason
          }
        })
      }).catch(() => {});
    }

    recordRun(status, seqOverride) {
      const seq = seqOverride || this.sequence;
      const data = seq
        ? {
            runId: seq.runId,
            conversationId: seq.entry.id,
            category: seq.entry.category,
            status,
            startedAt: seq.startedAt,
            lines: seq.spoken.length ? seq.spoken : seq.lines
          }
        : null;
      if (!data) return;
      fetch('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'conversation.record', params: data })
      })
        .then((res) => res.json())
        .then((json) => {
          const snapshot = json && json.result && json.result.conversations;
          if (snapshot && Array.isArray(snapshot.history)) this.history = snapshot.history;
        })
        .catch(() => {});
    }
  }

  window.ShopConversationEngine = ShopConversationEngine;
})();
