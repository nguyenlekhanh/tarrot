/**
 * Mystic Witch Live — tarot card markup.
 *
 * The text layer and the artwork layer are separate nodes on purpose. A
 * reversed card rotates only `.card-art`; every text node (position, name,
 * orientation, keywords) is a sibling, so no card name or label can ever be
 * rendered upside down or mirrored.
 */
(function (root) {
  'use strict';

  const SIGILS = { cups: '☾', swords: '⚔', pentacles: '✧', wands: '✦' };

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function sigilFor(card) {
    if (!card) return '✦';
    return card.arcana === 'major' ? '✦' : (SIGILS[card.suit] || '✦');
  }

  function cardMarkup(card) {
    const data = card || {};
    const keywords = (data.keywords || []).slice(0, 3).join(' · ');
    return `
      <div class="card-slot">
        <div class="card-inner">
          <div class="card-back">✦</div>
          <div class="card-face${data.reversed ? ' reversed-card' : ''}">
            <div class="card-position">${escapeHtml(String(data.position || '').toUpperCase())}</div>
            <div class="card-art"><span class="card-sigil">${sigilFor(data)}</span></div>
            <div class="card-name">${escapeHtml(data.name)}</div>
            <div class="card-orientation${data.reversed ? ' reversed' : ''}">${data.reversed ? 'REVERSED' : 'UPRIGHT'}</div>
            <div class="card-keywords">${escapeHtml(keywords)}</div>
          </div>
        </div>
      </div>`;
  }

  function resultCardMarkup(card) {
    const data = card || {};
    return `<div class="result-card${data.reversed ? ' is-reversed' : ''}">
          <div class="result-card-art"><span class="result-card-sigil">${sigilFor(data)}</span></div>
          <div class="result-card-name">${escapeHtml(data.name)}</div>
          <div class="result-card-position">${escapeHtml(String(data.position || '').toUpperCase())}</div>
          <div class="result-card-orientation">${data.reversed ? 'REVERSED' : 'UPRIGHT'}</div>
        </div>`;
  }

  function resultCardsMarkup(cards) {
    return (cards || []).map(resultCardMarkup).join('');
  }

  const api = { escapeHtml, sigilFor, cardMarkup, resultCardMarkup, resultCardsMarkup };

  root.TarotCardView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
