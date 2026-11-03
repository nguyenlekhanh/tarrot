/**
 * ShopMusicPlayer — Mystic Witch Live background playlist.
 *
 * - Eight original, locally generated instrumental tracks (see tools/generate_music.py)
 * - One HTMLAudioElement per player, so tracks never overlap
 * - Auto-advance on track end, wrap to the first track after the last one
 * - Preloads the next track, remembers the volume and last track
 * - Survives game state refreshes: nothing is recreated unless the player itself
 *   reloads, and the volume/track are restored from localStorage
 * - Handles autoplay restrictions by retrying on the first user gesture
 * - Skips missing/unplayable files and falls back to the synthesized ambience
 * - Stage and admin panel stay in sync through a BroadcastChannel: the stage owns
 *   playback, the admin panel mirrors it and sends play/pause/next/previous.
 */
(function () {
  const PLAYLIST = [
    { id: 'sunny-morning', title: 'Sunny Morning', url: '/assets/music/sunny-morning.mp3' },
    { id: 'summer-lemonade', title: 'Summer Lemonade', url: '/assets/music/summer-lemonade.mp3' },
    { id: 'happy-cafe', title: 'Happy Café', url: '/assets/music/happy-cafe.mp3' },
    { id: 'weekend-vibes', title: 'Weekend Vibes', url: '/assets/music/weekend-vibes.mp3' },
    { id: 'beachside-drive', title: 'Beachside Drive', url: '/assets/music/beachside-drive.mp3' },
    { id: 'coffee-break', title: 'Coffee Break', url: '/assets/music/coffee-break.mp3' },
    { id: 'good-times', title: 'Good Times', url: '/assets/music/good-times.mp3' },
    { id: 'little-sunshine', title: 'Little Sunshine', url: '/assets/music/little-sunshine.mp3' }
  ];

  const clamp01 = (v) => Math.max(0, Math.min(1, Number(v)));

  class ShopMusicPlayer {
    constructor(options = {}) {
      this.playlist = PLAYLIST;
      this.role = options.role === 'remote' ? 'remote' : 'stage';
      this.onChange = typeof options.onChange === 'function' ? options.onChange : null;
      this.onUnavailable = null;

      let savedIndex = parseInt(localStorage.getItem('shop_music_track'), 10);
      if (!Number.isFinite(savedIndex) || savedIndex < 0 || savedIndex >= PLAYLIST.length) savedIndex = 0;
      this.index = savedIndex;

      let savedVolume = parseFloat(localStorage.getItem('shop_music_vol'));
      this.volume = clamp01(Number.isFinite(savedVolume) ? savedVolume : options.volume ?? 0.55);

      // Playback preferences survive reloads and OBS restarts.
      this.shuffle = localStorage.getItem('shop_music_shuffle') === '1';
      this.repeat = localStorage.getItem('shop_music_repeat') !== '0';

      this.audio = null;
      this.preloadEl = null;
      this.playing = false;
      this.enabled = true;
      this.blocked = false;
      this.pendingPlay = false;
      this.ducked = false;
      this.unavailable = new Set();
      this.allUnavailable = false;
      this.remoteLinked = false;
      this.lastSyncAt = 0;
      this.mirror = null;
      this.bc = null;
      this.syncTimer = null;
      this._unlockAttached = false;
      this._switchGuard = 0;
      this.lastBroadcastKey = '';
    }

    // ---------------------------------------------------------------- getters
    get track() {
      return this.playlist[this.index] || null;
    }

    snapshot() {
      const base = {
        index: this.index,
        id: this.track ? this.track.id : '',
        title: this.track ? this.track.title : 'No track',
        playing: this.playing,
        enabled: this.enabled,
        blocked: this.blocked,
        volume: this.volume,
        ducked: this.ducked,
        shuffle: this.shuffle,
        repeat: this.repeat,
        trackCount: this.playlist.length,
        unavailable: Array.from(this.unavailable),
        remoteLinked: this.remoteLinked,
        time: 0,
        duration: 0
      };
      if (this.role === 'remote' && this.mirror && this.remoteLinked) {
        return { ...base, ...this.mirror, remoteLinked: true };
      }
      const audio = this.audio;
      if (audio) {
        base.time = audio.currentTime || 0;
        base.duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      }
      return base;
    }

    emit() {
      if (this.onChange) {
        try {
          this.onChange(this.snapshot());
        } catch (_) {}
      }
      // Push play/pause/track changes to the admin panel immediately. Progress is
      // broadcast on a slower 1s timer so timeupdate never floods the channel.
      const key = `${this.playing}|${this.index}|${this.blocked}|${this.enabled}|${this.shuffle}|${this.repeat}`;
      if (this.role === 'stage' && key !== this.lastBroadcastKey) {
        this.lastBroadcastKey = key;
        this.broadcast();
      }
    }

    // ------------------------------------------------------------------ audio
    ensureAudio() {
      if (this.audio) return this.audio;
      const audio = new Audio();
      audio.preload = 'auto';
      audio.volume = this.effectiveVolume();
      audio.addEventListener('ended', () => this.handleEnded());
      audio.addEventListener('timeupdate', () => this.emit());
      audio.addEventListener('loadedmetadata', () => this.emit());
      audio.addEventListener('play', () => {
        this.playing = true;
        this.emit();
      });
      audio.addEventListener('pause', () => {
        this.playing = false;
        this.emit();
      });
      audio.addEventListener('error', () => this.handleError());
      this.audio = audio;
      return audio;
    }

    effectiveVolume() {
      return clamp01(this.volume * (this.ducked ? 0.3 : 1));
    }

    applyVolume() {
      if (this.audio) this.audio.volume = this.effectiveVolume();
    }

    setVolume(value) {
      const val = clamp01(value);
      if (!Number.isFinite(val)) return;
      this.volume = val;
      try {
        localStorage.setItem('shop_music_vol', String(val));
      } catch (_) {}
      this.applyVolume();
      if (this.role === 'remote' && !this.localMode()) this.send('volume', val);
      this.emit();
    }

    setDuck(on) {
      const next = Boolean(on);
      if (this.ducked === next) return;
      this.ducked = next;
      this.rampVolume();
    }

    // Music fades under the Witch's voice instead of snapping, so the stream
    // never hears a click when narration starts or ends.
    rampVolume() {
      const audio = this.audio;
      if (!audio || typeof requestAnimationFrame !== 'function') {
        this.applyVolume();
        return;
      }
      if (this.rampHandle) cancelAnimationFrame(this.rampHandle);
      const target = this.effectiveVolume();
      const start = audio.volume;
      const startedAt = (typeof performance === 'object' ? performance.now() : Date.now());
      const step = () => {
        const elapsed = (typeof performance === 'object' ? performance.now() : Date.now()) - startedAt;
        const t = Math.min(1, elapsed / 260);
        audio.volume = clamp01(start + (target - start) * t);
        if (t < 1) this.rampHandle = requestAnimationFrame(step);
        else this.rampHandle = 0;
      };
      this.rampHandle = requestAnimationFrame(step);
    }

    setShuffle(on) {
      this.shuffle = Boolean(on);
      try {
        localStorage.setItem('shop_music_shuffle', this.shuffle ? '1' : '0');
      } catch (_) {}
      this.preloadNext();
      this.emit();
    }

    setRepeat(on) {
      this.repeat = Boolean(on);
      try {
        localStorage.setItem('shop_music_repeat', this.repeat ? '1' : '0');
      } catch (_) {}
      this.emit();
    }

    localMode() {
      return this.role !== 'remote' || !this.remoteLinked || Date.now() - this.lastSyncAt > 3200;
    }

    // -------------------------------------------------------------- transport
    async play() {
      if (!this.enabled) return;
      if (!this.localMode()) {
        this.send('play');
        return;
      }
      const track = this.track;
      if (!track || this.unavailable.has(track.id)) {
        this.skipUnavailable(1);
        return;
      }
      const audio = this.ensureAudio();
      if (!audio.src || !audio.src.endsWith(track.url)) {
        audio.src = track.url;
      }
      audio.volume = this.effectiveVolume();
      try {
        await audio.play();
        this.playing = true;
        this.blocked = false;
        this.pendingPlay = false;
      } catch (err) {
        const name = err && err.name;
        if (name === 'NotAllowedError') {
          // Autoplay is blocked until the viewer interacts with the page.
          this.blocked = true;
          this.pendingPlay = true;
          this.attachUnlockHandlers();
        } else if (name !== 'AbortError') {
          this.handleError();
        }
      }
      this.preloadNext();
      this.emit();
    }

    pause() {
      if (!this.localMode()) {
        this.send('pause');
        return;
      }
      if (this.audio) this.audio.pause();
      this.playing = false;
      this.pendingPlay = false;
      this.emit();
    }

    toggle() {
      if (this.playing) this.pause();
      else this.play();
    }

    async next(options = {}) {
      if (!this.localMode()) {
        this.send('next');
        return;
      }
      await this.switchTo(this.stepIndex(1), true);
    }

    async previous() {
      if (!this.localMode()) {
        this.send('previous');
        return;
      }
      await this.switchTo(this.stepIndex(-1), true);
    }

    async select(index) {
      if (!this.localMode()) {
        this.send('select', index);
        return;
      }
      const i = Number(index);
      if (!Number.isFinite(i) || i < 0 || i >= this.playlist.length) return;
      if (i === this.index && this.playing) return;
      await this.switchTo(i, true);
    }

    stepIndex(step) {
      const n = this.playlist.length;
      if (this.shuffle && n > 1) {
        const pool = [];
        for (let i = 0; i < n; i += 1) {
          if (i !== this.index && !this.unavailable.has(this.playlist[i].id)) pool.push(i);
        }
        if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
      }
      for (let hop = 1; hop <= n; hop++) {
        const candidate = (((this.index + step * hop) % n) + n) % n;
        const track = this.playlist[candidate];
        if (track && !this.unavailable.has(track.id)) return candidate;
      }
      return this.stepIndexRaw(step);
    }

    stepIndexRaw(step) {
      const n = this.playlist.length;
      return (((this.index + step) % n) + n) % n;
    }

    skipUnavailable(step) {
      const index = this.stepIndex(step);
      this.switchTo(index, this.playing || this.pendingPlay).catch(() => {});
    }

    async switchTo(index, autoplay) {
      if (!Number.isFinite(index)) return;
      // Stop the current track immediately so two tracks can never overlap.
      if (this.audio) {
        this.audio.pause();
        try {
          this.audio.currentTime = 0;
        } catch (_) {}
      }
      this.index = index;
      try {
        localStorage.setItem('shop_music_track', String(index));
      } catch (_) {}
      const track = this.track;
      const audio = this.ensureAudio();
      audio.src = track ? track.url : '';
      this.preloadNext();
      this.emit();
      if (track && autoplay && this.enabled) await this.play();
    }

    preloadNext() {
      const nextTrack = this.playlist[this.stepIndex(1)];
      if (!nextTrack) return;
      if (!this.preloadEl) {
        this.preloadEl = new Audio();
        this.preloadEl.preload = 'auto';
        this.preloadEl.muted = true;
      }
      if (this.preloadEl.src && this.preloadEl.src.endsWith(nextTrack.url)) return;
      this.preloadEl.src = nextTrack.url;
      try {
        this.preloadEl.load();
      } catch (_) {}
    }

    handleEnded() {
      // Repeat off simply stops at the end of the list; otherwise the playlist
      // (or shuffle) keeps rolling, which is what a 24/7 stream needs.
      if (!this.repeat && !this.shuffle && this.index >= this.playlist.length - 1) {
        this.pause();
        return;
      }
      // End of the last track wraps back to the first one.
      this.switchTo(this.stepIndex(1), this.enabled).catch(() => {});
    }

    handleError() {
      const track = this.track;
      if (!track) return;
      const wasPlaying = this.playing || this.pendingPlay;
      console.warn('[Music] Track unavailable:', track.title);
      this.unavailable.add(track.id);
      this.playing = false;
      if (this.unavailable.size >= this.playlist.length) {
        this.allUnavailable = true;
        this.emit();
        if (typeof this.onUnavailable === 'function') this.onUnavailable();
        return;
      }
      this._switchGuard += 1;
      if (this._switchGuard > this.playlist.length) return;
      const nextIndex = this.stepIndex(1);
      if (nextIndex !== this.index) {
        this.switchTo(nextIndex, wasPlaying).catch(() => {});
      }
      setTimeout(() => {
        this._switchGuard = 0;
      }, 2000);
    }

    setEnabled(on) {
      this.enabled = Boolean(on);
      if (!this.enabled) this.pause();
      else this.play();
      this.emit();
    }

    attachUnlockHandlers() {
      if (this._unlockAttached) return;
      this._unlockAttached = true;
      const unlock = () => {
        if (!this.blocked && !this.pendingPlay) return;
        this.blocked = false;
        if (this.pendingPlay) this.play();
      };
      ['pointerdown', 'keydown', 'touchstart'].forEach((evt) =>
        document.addEventListener(evt, unlock, { passive: true })
      );
    }

    // ------------------------------------------------------------------- sync
    initSync() {
      if (typeof BroadcastChannel !== 'function') return;
      try {
        this.bc = new BroadcastChannel('mystic-witch-music');
      } catch (_) {
        return;
      }
      this.bc.onmessage = (event) => this.onSyncMessage(event.data || {});
      if (this.role === 'remote') this.bc.postMessage({ type: 'probe' });
      else this.broadcast();
      setInterval(() => {
        if (this.role === 'stage' && this.playing) this.broadcast();
      }, 1000);
    }

    broadcast() {
      if (!this.bc || this.role !== 'stage') return;
      const snap = this.snapshot();
      this.bc.postMessage({ type: 'state', state: snap });
    }

    send(action, value) {
      if (!this.bc) return;
      this.bc.postMessage({ type: 'cmd', action, value });
    }

    onSyncMessage(msg) {
      if (this.role === 'remote' && msg.type === 'state' && msg.state) {
        this.mirror = msg.state;
        this.remoteLinked = true;
        this.lastSyncAt = Date.now();
        this.emit();
        return;
      }
      if (this.role !== 'stage') return;
      if (msg.type === 'probe') {
        this.broadcast();
        return;
      }
      if (msg.type !== 'cmd') return;
      switch (msg.action) {
        case 'play':
          this.play();
          break;
        case 'pause':
          this.pause();
          break;
        case 'next':
          this.next();
          break;
        case 'previous':
          this.previous();
          break;
        case 'select':
          this.select(msg.value);
          break;
        case 'shuffle':
          this.setShuffle(msg.value);
          break;
        case 'repeat':
          this.setRepeat(msg.value);
          break;
        case 'volume':
          this.setVolume(msg.value);
          break;
        case 'toggle':
          this.toggle();
          break;
        default:
          break;
      }
    }
  }

  window.ShopMusicPlayer = ShopMusicPlayer;
  window.SHOP_MUSIC_PLAYLIST = PLAYLIST;
})();
