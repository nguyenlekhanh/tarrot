/**
 * Mystic Witch Live — card reset timer.
 *
 * The stage returns to the idle table only after the reading's narration has
 * actually finished playing. The server generating TTS files proves nothing, so
 * the shared TtsQueue is the authority: it reports idle when the last clip ends.
 * This timer then waits a short configurable delay and fires once. Beginning a
 * new reading cancels any pending reset, so a reset can never interrupt the
 * next viewer.
 */
(function (root) {
  'use strict';

  const DEFAULT_DELAY_MS = 3000;
  const DEFAULT_FALLBACK_MS = 25000;

  function defaultTimers() {
    return {
      set: (fn, ms) => setTimeout(fn, ms),
      clear: (id) => clearTimeout(id)
    };
  }

  class ReadingResetTimer {
    constructor(options = {}) {
      this.delayMs = options.delayMs === undefined ? DEFAULT_DELAY_MS : options.delayMs;
      this.fallbackMs = Number.isFinite(options.fallbackMs) ? options.fallbackMs : DEFAULT_FALLBACK_MS;
      this.isQueueIdle = typeof options.isQueueIdle === 'function' ? options.isQueueIdle : () => true;
      this.onReset = typeof options.onReset === 'function' ? options.onReset : null;
      this.timers = options.timers || defaultTimers();
      this.readingId = '';
      this.heard = false;
      this.delayTimer = null;
      this.fallbackTimer = null;
    }

    get pending() {
      return Boolean(this.readingId);
    }

    /** A new reading owns the table: any pending reset is dropped. */
    begin(readingId) {
      this.clearTimers();
      this.readingId = String(readingId == null ? '' : readingId);
      this.heard = false;
      if (!this.readingId) return '';
      if (this.fallbackMs > 0) {
        this.fallbackTimer = this.timers.set(() => {
          this.fallbackTimer = null;
          // No clip ever arrived (narration disabled): still leave the table
          // clean, but only once the queue is quiet.
          if (!this.readingId) return;
          this.heard = true;
          this.maybeSchedule();
        }, this.fallbackMs);
      }
      return this.readingId;
    }

    /** A narration clip for this reading was queued. */
    heardClip(readingId) {
      if (!this.readingId) return false;
      if (!readingId || String(readingId) !== this.readingId) return false;
      this.heard = true;
      this.clearFallback();
      return true;
    }

    /** The shared clip queue drained: begin the short delay. */
    queueIdle() {
      if (!this.readingId || !this.heard) return false;
      if (!this.isQueueIdle()) return false;
      return this.schedule();
    }

    maybeSchedule() {
      if (!this.readingId) return false;
      if (!this.isQueueIdle()) return false;
      return this.schedule();
    }

    schedule() {
      if (this.delayTimer !== null) return false;
      const raw = typeof this.delayMs === 'function' ? this.delayMs() : this.delayMs;
      const ms = Number(raw);
      const delay = Number.isFinite(ms) && ms >= 0 ? ms : DEFAULT_DELAY_MS;
      this.delayTimer = this.timers.set(() => {
        this.delayTimer = null;
        const readingId = this.readingId;
        if (!readingId) return;
        this.readingId = '';
        this.heard = false;
        this.clearFallback();
        if (this.onReset) this.onReset(readingId);
      }, delay);
      return true;
    }

    cancel() {
      this.clearTimers();
      this.readingId = '';
      this.heard = false;
    }

    clearFallback() {
      if (this.fallbackTimer !== null) {
        this.timers.clear(this.fallbackTimer);
        this.fallbackTimer = null;
      }
    }

    clearTimers() {
      this.clearFallback();
      if (this.delayTimer !== null) {
        this.timers.clear(this.delayTimer);
        this.delayTimer = null;
      }
    }
  }

  root.ReadingResetTimer = ReadingResetTimer;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ReadingResetTimer, DEFAULT_DELAY_MS };
  }
})(typeof window !== 'undefined' ? window : globalThis);
