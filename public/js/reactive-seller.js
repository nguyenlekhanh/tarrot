/**
 * Mystic Witch Live — live reactive seller stage client.
 *
 * The server owns comment understanding, rate limits, LLM calls, validation and
 * order creation. This module only:
 *  - yields automatic seller chatter/announcements to a viewer reply
 *  - speaks the validated line through the existing Piper priority queue
 *  - reports when the line actually starts playing
 *
 * No API key, provider URL or comment instruction is evaluated here.
 */
(function () {
  class ShopReactiveSeller {
    constructor(options = {}) {
      this.audio = options.audio || null;
      this.announcer = options.announcer || null;
      this.conversations = options.conversations || null;
      this.snapshot = null;
      this.lastReply = null;
      this.handled = new Set();
      this.reported = new Set();
    }

    applySnapshot(snapshot) {
      if (!snapshot) return;
      this.snapshot = snapshot;
    }

    status() {
      return {
        settings: this.snapshot ? this.snapshot.settings : null,
        stats: this.snapshot ? this.snapshot.stats : null,
        lastReply: this.lastReply
      };
    }

    handleReply(event) {
      if (!event || event.type !== 'reactiveReply') return false;
      const replyId = String(event.replyId || '');
      if (replyId && this.handled.has(replyId)) return false;
      if (replyId) {
        this.handled.add(replyId);
        if (this.handled.size > 300) {
          const first = this.handled.values().next().value;
          this.handled.delete(first);
        }
      }

      this.lastReply = event;

      // A viewer comment is a priority-1 interaction. It stops the rest of an
      // automatic seller exchange, but never interrupts audio already playing.
      if (this.conversations) this.conversations.notifyPriority('viewer');
      if (this.announcer) this.announcer.notifyPersonalized();

      if (this.audio && event.ttsText) {
        this.audio.enqueueTts(event.ttsText, {
          engine: event.ttsEngine,
          voice: event.ttsVoice,
          piperVoice: event.ttsPiperFallbackVoice,
          language: event.ttsLanguage,
          speed: event.ttsSpeed,
          volume: event.ttsVolume,
          profile: event.ttsProfile,
          priority: 1,
          onStart: () => this.reportSpoken(replyId)
        });
      }
      return true;
    }

    reportSpoken(replyId) {
      if (!replyId || this.reported.has(replyId)) return;
      if (this.audio && this.audio.ttsEnabled === false) return;
      this.reported.add(replyId);
      if (this.reported.size > 300) {
        const first = this.reported.values().next().value;
        this.reported.delete(first);
      }
      fetch('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `spoken_${Date.now()}`,
          method: 'reactive.markSpoken',
          params: { replyId }
        })
      }).catch(() => {});
    }
  }

  window.ShopReactiveSeller = ShopReactiveSeller;
})();
