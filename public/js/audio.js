/**
 * ShopAudioEngine
 * - Sunny, synthesized background loop (no external audio asset required)
 * - Register "ka-ching", cup clink, heart pop, party horn and service bell synthesized
 *   with Web Audio so no extra dependency or sound file is needed
 * - Plays Piper voice lines from the local engine: requests are queued, played in
 *   order, never interrupted, and duck the music while speaking
 */
(function () {
  class ShopAudioEngine {
    constructor() {
      this.ctx = null;
      this.sfxEnabled = true;
      this.bgMusicEnabled = true;
      this.ttsEnabled = true;
      this.ttsEngine = 'piper';
      this.ttsLanguage = 'en';
      this.ttsVoice = 'en_US-amy-medium';
      this.ttsKokoroVoice = 'af_heart';
      this.ttsSpeed = 1;

      const savedMusic = parseFloat(localStorage.getItem('shop_music_vol'));
      const savedTts = parseFloat(localStorage.getItem('shop_tts_vol'));
      const savedSfx = parseFloat(localStorage.getItem('shop_sfx_vol'));
      this.bgBaseVolume = Number.isFinite(savedMusic) ? Math.max(0, Math.min(1, savedMusic)) : 0.28;
      this.ttsVolume = Number.isFinite(savedTts) ? Math.max(0, Math.min(1, savedTts)) : 0.9;
      // SFX sit on their own gain value so music/TTS levels never move them.
      this.sfxVolume = Number.isFinite(savedSfx) ? Math.max(0, Math.min(1, savedSfx)) : 0.85;
      this.lastSfx = new Map();

      this.synthBgTimer = null;
      this.ttsQueue = [];
      this.ttsPlaying = false;
      this.currentAudio = null;
      this.currentSpeech = null;
      this.onTtsStateChange = null;
      this.onMusicStateChange = null;

      // Background playlist (public/js/music.js). If every track is missing the
      // synthesized ambience below is used as the fallback.
      this.music = null;
      if (window.ShopMusicPlayer) {
        this.music = new window.ShopMusicPlayer({
          role: 'stage',
          volume: this.bgBaseVolume,
          onChange: (snap) => {
            if (typeof this.onMusicStateChange === 'function') this.onMusicStateChange(snap);
          }
        });
        this.music.onUnavailable = () => this.startAmbience();
        this.music.initSync();
      }
    }

    ensureContext() {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return null;
        this.ctx = new AudioCtx();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      if (this.bgMusicEnabled) this.startMusic();
      return this.ctx;
    }

    duckedVolume() {
      // Narration drops the bed to roughly 30% of its level.
      return Math.max(0.06, this.bgBaseVolume * 0.3);
    }

    setMusicVolume(vol) {
      const v = Math.max(0, Math.min(1, Number(vol)));
      if (!Number.isFinite(v)) return;
      this.bgBaseVolume = v;
      try {
        localStorage.setItem('shop_music_vol', String(v));
      } catch (_) {}
      if (this.music) this.music.setVolume(v);
    }

    setSfxVolume(vol) {
      const v = Math.max(0, Math.min(1, Number(vol)));
      if (!Number.isFinite(v)) return;
      this.sfxVolume = v;
      try {
        localStorage.setItem('shop_sfx_vol', String(v));
      } catch (_) {}
    }

    setTtsVolume(vol) {
      const v = Math.max(0, Math.min(1, Number(vol)));
      if (!Number.isFinite(v)) return;
      this.ttsVolume = v;
      try {
        localStorage.setItem('shop_tts_vol', String(v));
      } catch (_) {}
      // Volume is captured per speech item when it enters the queue. Changing the
      // default here must not alter speech that is already playing or waiting.
    }

    // ---------------------------------------------------------- ambience loop
    startAmbience() {
      if (!this.bgMusicEnabled || this.synthBgTimer || !this.ctx) return;
      const melody = [523.25, 659.25, 783.99, 659.25, 587.33, 659.25, 523.25, 392.0];
      const bass = [130.81, 164.81, 174.61, 196.0];
      let step = 0;
      const playStep = () => {
        if (!this.bgMusicEnabled || !this.ctx) return;
        try {
          const now = this.ctx.currentTime;
          const vol = (this.ttsPlaying ? this.duckedVolume() : this.bgBaseVolume) * 0.16;
          if (vol <= 0.003) return;

          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(melody[step % melody.length], now);
          gain.gain.setValueAtTime(0.0001, now);
          gain.gain.linearRampToValueAtTime(vol, now + 0.06);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          osc.onended = () => {
            osc.disconnect();
            gain.disconnect();
          };
          osc.start(now);
          osc.stop(now + 1.55);

          if (step % 4 === 0) {
            const bassOsc = this.ctx.createOscillator();
            const bassGain = this.ctx.createGain();
            bassOsc.type = 'sine';
            bassOsc.frequency.setValueAtTime(bass[(step / 4) % bass.length], now);
            bassGain.gain.setValueAtTime(0.0001, now);
            bassGain.gain.linearRampToValueAtTime(vol * 0.7, now + 0.12);
            bassGain.gain.exponentialRampToValueAtTime(0.0001, now + 2.4);
            bassOsc.connect(bassGain);
            bassGain.connect(this.ctx.destination);
            bassOsc.onended = () => {
              bassOsc.disconnect();
              bassGain.disconnect();
            };
            bassOsc.start(now);
            bassOsc.stop(now + 2.45);
          }
          step++;
        } catch (_) {}
      };
      playStep();
      this.synthBgTimer = setInterval(playStep, 1350);
    }

    stopAmbience() {
      if (this.synthBgTimer) {
        clearInterval(this.synthBgTimer);
        this.synthBgTimer = null;
      }
    }

    // ------------------------------------------------------- background playlist
    startMusic() {
      if (!this.bgMusicEnabled) return;
      if (this.music) {
        this.music.enabled = true;
        this.music.setVolume(this.bgBaseVolume);
        this.music.play();
        return;
      }
      this.startAmbience();
    }

    setMusicEnabled(on) {
      const next = Boolean(on);
      const changed = next !== this.bgMusicEnabled;
      this.bgMusicEnabled = next;
      if (this.music) {
        if (changed) this.music.setEnabled(next);
        return;
      }
      if (!next) this.stopAmbience();
      else this.startAmbience();
    }

    /** Snapshot for the announcer + admin panel. */
    getSpeechStatus() {
      return {
        playing: this.ttsPlaying,
        current: this.currentAudio ? this.currentAudio.src : '',
        queued: this.ttsQueue.map((item) => ({
          text: item.text,
          priority: item.priority || 1,
          engine: item.engine,
          voice: item.voice,
          fallbackVoice: item.piperVoice,
          profile: item.profile,
          volume: item.volume
        }))
      };
    }

    getMusicState() {
      return this.music ? this.music.snapshot() : null;
    }

    // --------------------------------------------------------------- one shots
    tone(freq, duration, type = 'sine', volume = 0.18, startOffset = 0, slideTo = 0) {
      if (!this.sfxEnabled) return;
      const scaled = Math.max(0, Math.min(1, volume * this.sfxVolume));
      if (scaled <= 0.001) return;
      try {
        const ctx = this.ensureContext();
        if (!ctx) return;
        const now = ctx.currentTime + startOffset;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, now);
        if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, now + duration * 0.9);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(scaled, now + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.onended = () => {
          osc.disconnect();
          gain.disconnect();
        };
        osc.start(now);
        osc.stop(now + duration + 0.02);
      } catch (_) {}
    }

    playRegister() {
      this.tone(880, 0.09, 'square', 0.09);
      this.tone(1320, 0.24, 'triangle', 0.12, 0.08);
    }

    playCupClink() {
      this.tone(1860, 0.14, 'sine', 0.08);
      this.tone(2400, 0.1, 'sine', 0.05, 0.03);
    }

    playHeartPop() {
      this.tone(520, 0.12, 'sine', 0.1, 0, 900);
    }

    playServiceBell() {
      this.tone(1046, 0.9, 'sine', 0.14);
      this.tone(1568, 0.7, 'sine', 0.06, 0.02);
    }

    playParty() {
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
        this.tone(freq, 0.22, 'triangle', 0.11, i * 0.09);
      });
    }

    // Throttle so a burst of TikTok events never stacks the same cue.
    sfxAllowed(key, gapMs) {
      const now = Date.now();
      const last = this.lastSfx.get(key) || 0;
      if (now - last < gapMs) return false;
      this.lastSfx.set(key, now);
      return true;
    }

    playCoin() {
      if (!this.sfxAllowed('coin', 260)) return;
      [1046.5, 1318.5, 1568].forEach((freq, i) => this.tone(freq, 0.14, 'triangle', 0.08, i * 0.07));
    }

    playVipUpgrade() {
      if (!this.sfxAllowed('vip', 900)) return;
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((freq, i) =>
        this.tone(freq, 0.3, 'triangle', 0.11, i * 0.1)
      );
      this.tone(2093, 0.45, 'sine', 0.05, 0.5);
    }

    playCelebration() {
      if (!this.sfxAllowed('celebrate', 700)) return;
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => this.tone(freq, 0.24, 'square', 0.09, i * 0.08));
      this.tone(1568, 0.5, 'triangle', 0.06, 0.36);
    }

    playFireworks() {
      if (!this.sfxAllowed('fireworks', 1200)) return;
      this.tone(220, 0.5, 'sawtooth', 0.05, 0, 80);
      [659.25, 880, 1046.5, 1318.5, 1568].forEach((freq, i) =>
        this.tone(freq, 0.3, 'triangle', 0.09, 0.18 + i * 0.12)
      );
    }

    // --------------------------------------------------------------- voice queue
    enqueueTts(text, options = {}) {
      const onStart = typeof options.onStart === 'function' ? options.onStart : null;
      const onEnd = typeof options.onEnd === 'function' ? options.onEnd : null;

      if (!this.ttsEnabled) {
        if (onStart) onStart();
        if (onEnd) setTimeout(onEnd, 3800);
        return;
      }
      const clean = String(text || '').trim();
      if (!clean) {
        if (onStart) onStart();
        if (onEnd) setTimeout(onEnd, 3800);
        return;
      }

      // Priority 0 = gifts/VIP, 1 = viewer replies, 2 = automatic announcements.
      const priority = Number.isFinite(Number(options.priority)) ? Number(options.priority) : 1;
      const engine = options.engine === 'kokoro' ? 'kokoro' : options.engine === 'piper' ? 'piper' : this.ttsEngine;
      const voice =
        options.voice ||
        (engine === 'kokoro' ? this.ttsKokoroVoice : this.ttsVoice) ||
        'en_US-amy-medium';

      // Never enqueue the same line twice while it is waiting or already
      // playing. This is a queue guard only; the scheduler still owns pacing.
      const isDuplicate = () =>
        (this.currentSpeech &&
          this.currentSpeech.text === clean &&
          this.currentSpeech.voice === voice &&
          this.currentSpeech.engine === engine) ||
        this.ttsQueue.some(
          (queued) => queued.text === clean && queued.voice === voice && queued.engine === engine
        );
      if (isDuplicate()) return false;

      // Automatic chatter never queues behind speech and never floods the queue.
      if (priority >= 2) {
        if (this.ttsPlaying || this.ttsQueue.length > 0) return false;
      }
      // An important line clears queued automatic chatter — never playing audio.
      if (priority <= 1 && this.ttsQueue.length >= 2) {
        this.ttsQueue = this.ttsQueue.filter((queued) => (queued.priority || 1) < 2);
      }
      if (this.ttsQueue.length >= 6) {
        const dropped = this.ttsQueue.shift();
        if (dropped && dropped.onStart) dropped.onStart();
        if (dropped && dropped.onEnd) dropped.onEnd();
      }

      // Voice, speed and volume are frozen here. A later profile edit never
      // rewrites a line that is already queued or playing.
      const item = {
        id: `tts_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        priority,
        engine,
        text: clean,
        language: options.language || this.ttsLanguage || 'en',
        voice,
        piperVoice: options.piperVoice || this.ttsVoice || 'en_US-amy-medium',
        speed: Number(options.speed || this.ttsSpeed || 1),
        volume: Math.max(0, Math.min(1, Number(options.volume ?? this.ttsVolume ?? 0.9))),
        profile: options.profile || '',
        url: options.url || null,
        onStart,
        onEnd,
        fetchPromise: null
      };
      if (!item.url) {
        item.fetchPromise = this.fetchPiperAudio(item.text, {
          engine: item.engine,
          language: item.language,
          voice: item.voice,
          speed: item.speed,
          piperVoice: item.piperVoice
        });
      }

      // Higher priority items move to the front of the waiting line.
      let insertAt = this.ttsQueue.findIndex((queued) => (queued.priority || 1) > priority);
      if (insertAt === -1) insertAt = this.ttsQueue.length;
      this.ttsQueue.splice(insertAt, 0, item);
      this.processTtsQueue();
      return true;
    }

    async fetchPiperAudio(text, options = {}) {
      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            engine: options.engine || this.ttsEngine,
            language: options.language || this.ttsLanguage,
            voice: options.voice || this.ttsVoice,
            speed: options.speed || this.ttsSpeed,
            piperVoice: options.piperVoice || this.ttsVoice
          })
        });
        const data = await res.json();
        if (data && data.ok && data.url) return data;
        return { ok: false, error: data && data.error ? data.error : 'Voice engine unavailable' };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    async processTtsQueue() {
      if (this.ttsPlaying || this.ttsQueue.length === 0) return;
      this.ttsPlaying = true;
      if (this.music) this.music.setDuck(true);
      const item = this.ttsQueue.shift();
      this.currentSpeech = item;

      try {
        let audioUrl = item.url;
        if (!audioUrl && item.fetchPromise) {
          const res = await item.fetchPromise;
          if (res && res.ok && res.url) {
            audioUrl = res.url;
            if (res.engine === 'piper' || res.engine === 'kokoro') item.engine = res.engine;
            if (res.voice) item.voice = res.voice;
            if (res.fallback) item.fallback = true;
          }
        }
        if (audioUrl) {
          if (this.onTtsStateChange) {
            this.onTtsStateChange({
              speaking: true,
              text: item.text,
              engine: item.engine,
              voice: item.voice,
              profile: item.profile
            });
          }
          if (item.onStart) item.onStart();
          await this.playAudioUrl(audioUrl, item.volume);
          if (item.onEnd) item.onEnd();
        } else {
          if (item.onStart) item.onStart();
          if (item.onEnd) setTimeout(item.onEnd, 3800);
        }
      } catch (err) {
        console.warn('[Voice playback]', err && err.message);
        if (item.onStart) item.onStart();
        if (item.onEnd) item.onEnd();
      } finally {
        this.ttsPlaying = false;
        this.currentSpeech = null;
        if (this.music) this.music.setDuck(false);
        if (this.onTtsStateChange) this.onTtsStateChange({ speaking: false, text: '' });
        if (this.ttsQueue.length > 0) setTimeout(() => this.processTtsQueue(), 220);
      }
    }

    playAudioUrl(url, volume) {
      return new Promise((resolve) => {
        try {
          const audio = new Audio(url);
          this.currentAudio = audio;
          const level = Number(volume);
          audio.volume = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : this.ttsVolume;
          audio.onended = () => {
            this.currentAudio = null;
            resolve();
          };
          audio.onerror = () => {
            this.currentAudio = null;
            resolve();
          };
          const p = audio.play();
          if (p && typeof p.catch === 'function') {
            p.catch(() => {
              this.currentAudio = null;
              resolve();
            });
          }
        } catch (_) {
          resolve();
        }
      });
    }
  }

  window.ShopAudioEngine = ShopAudioEngine;
})();
