/**
 * Mystic Witch Live — shared TTS clip queue.
 *
 * One clip at a time, in order, never overlapping. The stage uses it for every
 * spoken line (tarot narration, gift thanks, ambient Oracle dialogue), so a
 * reading can never be cut off by the next clip and two lines never play
 * together. The factory is injectable, which keeps the queue unit-testable
 * without a browser.
 */
(function (root) {
  'use strict';

  class TtsQueue {
    constructor(options = {}) {
      this.limit = Math.max(2, Number(options.limit) || 16);
      this.create = typeof options.create === 'function' ? options.create : null;
      this.onChange = typeof options.onChange === 'function' ? options.onChange : null;
      this.onIdle = typeof options.onIdle === 'function' ? options.onIdle : null;
      // Playback boundaries are reported per clip so the ceremony can advance on
      // real audio instead of on synthesis or on an RPC reply.
      this.onStart = typeof options.onStart === 'function' ? options.onStart : null;
      this.onEnd = typeof options.onEnd === 'function' ? options.onEnd : null;
      this.items = [];
      this.audio = null;
      this.playing = false;
      this.total = 0;
      this.dropped = 0;
    }

    get size() {
      return this.items.length;
    }

    get busy() {
      return this.playing;
    }

    push(clip) {
      if (!clip || !clip.url) return false;
      if (this.items.length >= this.limit) {
        this.items.shift();
        this.dropped += 1;
      }
      this.items.push(clip);
      this.emit();
      this.pump();
      return true;
    }

    pump() {
      if (this.playing || !this.items.length) return;
      const clip = this.items.shift();
      let audio = null;
      try {
        audio = this.create ? this.create(clip) : null;
      } catch (_) {
        audio = null;
      }
      if (!audio || typeof audio.play !== 'function') {
        // A missing player must not stall the rest of the queue.
        this.emit();
        return this.pump();
      }
      this.playing = true;
      this.audio = audio;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        audio.onended = null;
        audio.onerror = null;
        if (this.audio === audio) this.audio = null;
        this.playing = false;
        this.total += 1;
        if (this.onEnd) {
          try { this.onEnd(clip); } catch (_) {}
        }
        this.emit();
        if (!this.items.length) this.idle();
        this.pump();
      };
      audio.onended = finish;
      audio.onerror = finish;
      if (this.onStart) {
        try { this.onStart(clip); } catch (_) {}
      }
      try {
        const started = audio.play();
        if (started && typeof started.catch === 'function') started.catch(finish);
      } catch (_) {
        finish();
      }
      this.emit();
    }

    idle() {
      if (this.onIdle) this.onIdle();
    }

    clear() {
      this.items = [];
      if (this.audio && typeof this.audio.pause === 'function') {
        try { this.audio.pause(); } catch (_) {}
      }
      this.audio = null;
      this.playing = false;
      this.emit();
    }

    emit() {
      if (!this.onChange) return;
      this.onChange({ size: this.items.length, playing: this.playing, total: this.total });
    }
  }

  root.TtsQueue = TtsQueue;
  if (typeof module !== 'undefined' && module.exports) module.exports = { TtsQueue };
})(typeof window !== 'undefined' ? window : globalThis);
