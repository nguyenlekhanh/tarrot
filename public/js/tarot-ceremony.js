/**
 * Mystic Witch Live — tarot ceremony state machine.
 *
 * One ceremony at a time, in this exact order:
 *
 *   IDLE -> ANNOUNCING -> PREPARING -> REVEALING -> INTERPRETING -> CLOSING -> RESETTING -> IDLE
 *
 * The stage controller owns the visuals and the audio; this module only owns the
 * order and the identity of the ceremony. Every transition carries the epoch of
 * the ceremony that scheduled it, so a timer or a clip callback from an earlier
 * reading can never move a newer ceremony forward.
 */
(function (root) {
  'use strict';

  const STATES = Object.freeze({
    IDLE: 'IDLE',
    ANNOUNCING: 'ANNOUNCING',
    PREPARING: 'PREPARING',
    REVEALING: 'REVEALING',
    INTERPRETING: 'INTERPRETING',
    CLOSING: 'CLOSING',
    RESETTING: 'RESETTING'
  });

  const ORDER = [
    STATES.IDLE,
    STATES.ANNOUNCING,
    STATES.PREPARING,
    STATES.REVEALING,
    STATES.INTERPRETING,
    STATES.CLOSING,
    STATES.RESETTING
  ];

  const NEXT = Object.freeze({
    IDLE: STATES.ANNOUNCING,
    ANNOUNCING: STATES.PREPARING,
    PREPARING: STATES.REVEALING,
    REVEALING: STATES.INTERPRETING,
    INTERPRETING: STATES.CLOSING,
    CLOSING: STATES.RESETTING,
    RESETTING: STATES.IDLE
  });

  class TarotCeremony {
    constructor(options = {}) {
      this.now = typeof options.now === 'function' ? options.now : () => Date.now();
      this.onEnter = typeof options.onEnter === 'function' ? options.onEnter : null;
      this.onReject = typeof options.onReject === 'function' ? options.onReject : null;
      this.state = STATES.IDLE;
      this.readingId = '';
      this.epoch = 0;
      this.enteredAt = 0;
      this.transitions = 0;
    }

    get busy() {
      return this.state !== STATES.IDLE;
    }

    get nextState() {
      return NEXT[this.state] || STATES.IDLE;
    }

    get elapsed() {
      return this.now() - this.enteredAt;
    }

    /** Only one ceremony may exist at a time; a second reading is never merged in. */
    begin(readingId) {
      if (this.busy) {
        if (this.onReject) this.onReject({ readingId, state: this.state, reason: 'busy' });
        return false;
      }
      this.epoch += 1;
      this.readingId = String(readingId == null ? '' : readingId);
      this.enter(STATES.ANNOUNCING);
      return true;
    }

    /** True while `epoch` still belongs to the running ceremony. */
    isCurrent(epoch) {
      return Number(epoch) === this.epoch;
    }

    /**
     * Advance one step. The caller names the state it believes the ceremony is
     * in, so a late callback from an earlier phase (or an earlier reading) is
     * dropped instead of skipping a step.
     */
    advance(expectedState, epoch) {
      if (!this.isCurrent(epoch)) return false;
      if (expectedState && this.state !== expectedState) return false;
      const next = NEXT[this.state];
      if (!next) return false;
      this.enter(next);
      return true;
    }

    /** Close the ceremony from RESETTING; only the owning reading may do this. */
    finish(epoch) {
      if (!this.isCurrent(epoch)) return false;
      if (this.state !== STATES.RESETTING) return false;
      this.enter(STATES.IDLE);
      this.readingId = '';
      return true;
    }

    /** Emergency stop: invalidates every timer and callback of the old reading. */
    abort() {
      this.epoch += 1;
      this.readingId = '';
      this.state = STATES.IDLE;
      this.enteredAt = this.now();
      if (this.onEnter) this.onEnter(STATES.IDLE, this.snapshot());
      return true;
    }

    snapshot() {
      return {
        state: this.state,
        readingId: this.readingId,
        epoch: this.epoch,
        elapsed: this.elapsed,
        transitions: this.transitions
      };
    }

    enter(state) {
      this.state = state;
      this.enteredAt = this.now();
      this.transitions += 1;
      if (this.onEnter) this.onEnter(state, this.snapshot());
    }
  }

  root.TarotCeremony = TarotCeremony;
  root.TAROT_CEREMONY = STATES;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TarotCeremony, TAROT_CEREMONY: STATES, TAROT_CEREMONY_ORDER: ORDER };
  }
})(typeof window !== 'undefined' ? window : globalThis);
