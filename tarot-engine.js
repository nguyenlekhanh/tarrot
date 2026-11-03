'use strict';

/**
 * Mystic Witch Live — Tarot engine.
 *
 * Deliberately dependency-free and deterministic when given a seeded RNG, so it
 * can be unit-tested and reused from the server, the RPC layer and the tests.
 *
 * Responsibilities:
 *   - the complete 78-card Rider-Waite deck (22 Major + 56 Minor Arcana);
 *   - upright / reversed orientation;
 *   - server-side selection with no duplicate cards inside one spread;
 *   - one-card and three-card (Past / Present / Future) spreads;
 *   - a stable, structured interpretation built from built-in data (the LLM
 *     layer is optional and lives in the server, never here);
 *   - durable reading history in a JSON file, one unique ID per reading.
 *
 * Card selection never consults the interpretation layer, so an LLM outage can
 * never change which cards were drawn.
 */

const fs = require('fs');
const path = require('path');

const SPREADS = Object.freeze({
  one: { id: 'one', size: 1, positions: ['Guidance'] },
  three: { id: 'three', size: 3, positions: ['Past', 'Present', 'Future'] }
});

const ORIENTATIONS = Object.freeze(['upright', 'reversed']);

const THEMES = Object.freeze(['general', 'love', 'career', 'future']);

// --- Major Arcana -----------------------------------------------------------
// [name, keywords, upright, reversed]
const MAJOR_ARCANA = [
  ['The Fool', ['beginnings', 'innocence', 'leap of faith'], 'A fresh start taken on instinct, before the map is finished.', 'Recklessness or a leap you are not ready to make.'],
  ['The Magician', ['manifestation', 'will', 'skill'], 'You already hold the tools; focused will turns intention into form.', 'Scattered power, tricks, or talent used for the wrong aim.'],
  ['The High Priestess', ['intuition', 'secrets', 'stillness'], 'The answer is already inside you, waiting for quiet to be heard.', 'Ignored intuition, hidden information, or a truth kept from you.'],
  ['The Empress', ['abundance', 'nurture', 'creation'], 'Something is growing under your care and asking to be fed.', 'Neglect, creative block, or giving until nothing is left.'],
  ['The Emperor', ['structure', 'authority', 'order'], 'A boundary or plan gives this situation its spine.', 'Rigidity, control, or authority that has stopped listening.'],
  ['The Hierophant', ['tradition', 'teaching', 'belonging'], 'An old rule, mentor, or shared framework offers the way through.', 'Dogma, or a tradition you have outgrown.'],
  ['The Lovers', ['union', 'choice', 'values'], 'A real choice, made from what you actually value.', 'Misalignment, temptation, or a bond that asks too much.'],
  ['The Chariot', ['drive', 'victory', 'direction'], 'Momentum belongs to whoever holds the reins.', 'Stalling, scattered effort, or force without direction.'],
  ['Strength', ['courage', 'patience', 'mastery'], 'Gentle persistence tames what force could not.', 'Self-doubt, or an inner wildness left unmanaged.'],
  ['The Hermit', ['solitude', 'reflection', 'guidance'], 'Step back and carry your own lantern for a while.', 'Isolation, or withdrawal that has become hiding.'],
  ['Wheel of Fortune', ['cycles', 'turning point', 'fate'], 'The wheel is already turning; meet the change instead of bracing.', 'A cycle repeating because its lesson is unlearned.'],
  ['Justice', ['truth', 'balance', 'accountability'], 'Cause and effect are about to settle the account.', 'Bias, evasion, or a verdict that ignores the facts.'],
  ['The Hanged Man', ['surrender', 'perspective', 'pause'], 'The pause is the move; see it upside down and it opens.', 'Stalling dressed as patience, or sacrifice for nothing.'],
  ['Death', ['ending', 'transformation', 'release'], 'One chapter genuinely closes so the next can exist.', 'Clinging to what has already ended.'],
  ['Temperance', ['balance', 'patience', 'blending'], 'Slow, careful mixing of opposites produces the right result.', 'Excess, impatience, or a mix that never settles.'],
  ['The Devil', ['attachment', 'temptation', 'bondage'], 'A chain you hold yourself, and could put down.', 'Breaking free, or finally naming the attachment.'],
  ['The Tower', ['upheaval', 'revelation', 'collapse'], 'A structure fails loudly so the false thing stops standing.', 'A disaster absorbed, or the fall delayed and softened.'],
  ['The Star', ['hope', 'healing', 'renewal'], 'Quiet, credible hope after a hard stretch.', 'Discouragement, or faith that needs rebuilding.'],
  ['The Moon', ['illusion', 'dreams', 'uncertainty'], 'Not everything in the dark is what it looks like.', 'Confusion clearing, or a fear exposed as smoke.'],
  ['The Sun', ['joy', 'clarity', 'success'], 'Clear light, plain truth, and a genuine good day.', 'Delayed joy, or a success that feels smaller than promised.'],
  ['Judgement', ['awakening', 'reckoning', 'calling'], 'A call you cannot un-hear, and the honesty to answer it.', 'Self-doubt, or a summons ignored too long.'],
  ['The World', ['completion', 'integration', 'return'], 'The circle closes; take the whole lesson with you.', 'Almost finished, or a closure withheld.']
];

// --- Minor Arcana -----------------------------------------------------------
const SUITS = [
  { id: 'wands', name: 'Wands', element: 'Fire', domain: 'passion, drive and creative ambition' },
  { id: 'cups', name: 'Cups', element: 'Water', domain: 'emotion, love and intuition' },
  { id: 'swords', name: 'Swords', element: 'Air', domain: 'thought, truth and conflict' },
  { id: 'pentacles', name: 'Pentacles', element: 'Earth', domain: 'work, money and the material world' }
];

// [rank name, keywords, upright, reversed]
const RANKS = [
  ['Ace', ['beginning', 'spark', 'opportunity'], 'A raw beginning in', 'A start blocked, delayed, or held back in'],
  ['Two', ['balance', 'choice', 'partnership'], 'A choice or pairing in', 'An imbalance or stalemate in'],
  ['Three', ['growth', 'collaboration', 'progress'], 'Early growth and shared effort in', 'Stalled progress or friction in'],
  ['Four', ['stability', 'structure', 'rest'], 'A settled, stable phase in', 'Stagnation or a need to loosen the grip on'],
  ['Five', ['conflict', 'loss', 'friction'], 'Conflict and discomfort in', 'A conflict easing, or its cost finally counted in'],
  ['Six', ['harmony', 'recovery', 'generosity'], 'Recovery and generosity in', 'Old wounds lingering, or give-and-take out of balance in'],
  ['Seven', ['assessment', 'patience', 'strategy'], 'A pause to assess and choose in', 'Wishful thinking or avoidance in'],
  ['Eight', ['movement', 'mastery', 'effort'], 'Steady movement and skill in', 'Delay, burnout, or misdirected effort in'],
  ['Nine', ['culmination', 'resilience', 'independence'], 'Near-completion and hard-won resilience in', 'Anxiety or self-reliance pushed too far in'],
  ['Ten', ['completion', 'fulfilment', 'burden'], 'A full cycle in', 'A burden carried past its usefulness in'],
  ['Page', ['message', 'curiosity', 'study'], 'A message or beginner’s curiosity in', 'Immaturity or a message half-understood in'],
  ['Knight', ['action', 'quest', 'momentum'], 'Fast, committed action in', 'Recklessness or a charge in the wrong direction in'],
  ['Queen', ['mastery', 'nurture', 'presence'], 'Quiet mastery and care in', 'Overwhelm or a caretaker running empty in'],
  ['King', ['authority', 'command', 'judgement'], 'Authority and clear judgement in', 'Control issues or authority misused in']
];

function buildDeck() {
  const cards = MAJOR_ARCANA.map((entry, index) => {
    const [name, keywords, upright, reversed] = entry;
    return {
      id: `major-${String(index).padStart(2, '0')}`,
      name,
      arcana: 'major',
      suit: null,
      rank: null,
      number: index,
      keywords: [...keywords],
      upright: upright.trim(),
      reversed
    };
  });

  for (const suit of SUITS) {
    RANKS.forEach((entry, index) => {
      const [rank, keywords, upOpen, revOpen] = entry;
      cards.push({
        id: `minor-${suit.id}-${String(index + 1).padStart(2, '0')}`,
        name: `${rank} of ${suit.name}`,
        arcana: 'minor',
        suit: suit.id,
        rank,
        number: index + 1,
        keywords: [...keywords, suit.id],
        upright: `${upOpen} ${suit.domain}.`,
        reversed: `${revOpen} ${suit.domain}.`
      });
    });
  }

  return cards;
}

const DECK = buildDeck();
const CARD_BY_ID = new Map(DECK.map((card) => [card.id, card]));

// --- helpers ----------------------------------------------------------------

function shuffle(list, random) {
  const items = [...list];
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function cleanText(value, maxLength) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeSpread(value) {
  const key = String(value || '').toLowerCase();
  if (key === 'one' || key === '1' || key === 'single' || key === 'one-card') return 'one';
  if (key === 'three' || key === '3' || key === 'three-card' || key === 'past-present-future') return 'three';
  return 'three';
}

function normalizeTheme(value) {
  const key = String(value || '').toLowerCase();
  return THEMES.includes(key) ? key : 'general';
}

const THEME_FOCUS = {
  general: 'your situation as a whole',
  love: 'love and the people you are bonded to',
  career: 'work, money and the path you are building',
  future: 'what is coming next'
};

/** Position-aware sentence built only from built-in card data. */
function describeCard(card, position, theme) {
  const meaning = card.reversed ? card.reversed : card.upright;
  const orientation = card.reversed ? 'reversed' : 'upright';
  const focus = THEME_FOCUS[theme] || THEME_FOCUS.general;
  const positionLine = position === 'Guidance'
    ? `The cards speak to ${focus}`
    : `In the ${position.toLowerCase()} position, this speaks to ${focus}`;
  return `${positionLine}: ${card.name} ${orientation} — ${meaning}`;
}

function summarize(reading) {
  const names = reading.cards.map((card) => `${card.name}${card.reversed ? ' (reversed)' : ''}`);
  const lead = reading.spread === 'three'
    ? `${names[0]} in the past, ${names[1]} in the present, ${names[2]} in the future`
    : names[0];
  const closing = reading.theme === 'love'
    ? 'Hold the feeling gently and let the other person show you their hand.'
    : reading.theme === 'career'
      ? 'Take the next practical step; the path opens by walking it.'
      : reading.theme === 'future'
        ? 'The future is not fixed — this is the shape it is leaning toward.'
        : 'Sit with the message before you act on it.';
  return `${lead}. ${closing}`;
}

// --- history store ----------------------------------------------------------

class ReadingStore {
  constructor(options = {}) {
    this.file = options.file || path.join(__dirname, 'data', 'tarot-history.json');
    this.limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Number(options.limit)) : 200;
    this.readings = [];
    this.loaded = false;
  }

  load() {
    if (this.loaded) return this.readings;
    this.loaded = true;
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.readings) ? parsed.readings : [];
      this.readings = list.filter((item) => item && typeof item === 'object' && item.id).slice(0, this.limit);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn(`[Tarot] Could not read history (${this.file}): ${err.message}`);
      }
      this.readings = [];
    }
    return this.readings;
  }

  save() {
    const payload = JSON.stringify({ version: 1, savedAt: new Date().toISOString(), readings: this.readings }, null, 2);
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, payload, 'utf8');
    fs.renameSync(tmp, this.file);
    return this.file;
  }

  add(reading) {
    this.load();
    this.readings.unshift(reading);
    if (this.readings.length > this.limit) this.readings.length = this.limit;
    this.save();
    return reading;
  }

  list(limit = 20) {
    this.load();
    const count = Math.max(1, Math.min(Number(limit) || 20, this.limit));
    return this.readings.slice(0, count);
  }

  get(id) {
    this.load();
    return this.readings.find((item) => item.id === id) || null;
  }

  clear() {
    this.readings = [];
    this.loaded = true;
    this.save();
    return { ok: true, cleared: true };
  }

  count() {
    this.load();
    return this.readings.length;
  }
}

// --- engine -----------------------------------------------------------------

let readingSeq = 0;

class TarotEngine {
  constructor(options = {}) {
    this.random = typeof options.random === 'function' ? options.random : Math.random;
    this.now = typeof options.now === 'function' ? options.now : () => new Date();
    this.deck = Array.isArray(options.deck) && options.deck.length ? options.deck : DECK;
    this.store = options.store instanceof ReadingStore
      ? options.store
      : new ReadingStore({ file: options.historyFile, limit: options.historyLimit });
    this.maxQuestionLength = Math.max(20, Number(options.maxQuestionLength) || 200);
  }

  get deckSize() {
    return this.deck.length;
  }

  orientationFor() {
    return this.random() < 0.5 ? 'upright' : 'reversed';
  }

  /**
   * Draw without replacement: a spread can never contain the same card twice,
   * in either orientation.
   */
  drawCards(size) {
    const drawn = [];
    const used = new Set();
    let guard = 0;
    while (drawn.length < size && guard < 5000) {
      guard += 1;
      const card = this.deck[Math.floor(this.random() * this.deck.length)];
      if (!card || used.has(card.id)) continue;
      used.add(card.id);
      const orientation = this.orientationFor();
      drawn.push({
        id: card.id,
        name: card.name,
        arcana: card.arcana,
        suit: card.suit,
        rank: card.rank,
        number: card.number,
        keywords: [...card.keywords],
        orientation,
        reversed: orientation === 'reversed'
      });
    }
    return drawn;
  }

  /**
   * One reading = one unique ID + cards + interpretation, persisted to history.
   * Card selection happens before any interpretation work, so callers can add an
   * LLM narration afterwards without touching the draw.
   */
  read(params = {}) {
    const spreadId = normalizeSpread(params.spread);
    const spread = SPREADS[spreadId];
    const theme = normalizeTheme(params.theme);
    const question = cleanText(params.question, this.maxQuestionLength);
    const cards = this.drawCards(spread.size);
    const createdAt = this.now();
    readingSeq += 1;

    const interpreted = cards.map((card, index) => {
      const position = spread.positions[index];
      return {
        ...card,
        position,
        meaning: card.reversed ? CARD_BY_ID.get(card.id).reversed : CARD_BY_ID.get(card.id).upright,
        interpretation: describeCard(card, position, theme)
      };
    });

    const reading = {
      id: `tarot_${createdAt.getTime()}_${readingSeq}_${Math.random().toString(36).slice(2, 6)}`,
      createdAt: createdAt.toISOString(),
      spread: spreadId,
      positions: [...spread.positions],
      theme,
      question,
      user: cleanText(params.user, 60) || 'Guest',
      uniqueId: cleanText(params.uniqueId, 60).toLowerCase(),
      source: cleanText(params.source, 20) || 'rpc',
      trigger: cleanText(params.trigger, 40) || '',
      cards: interpreted
    };

    reading.summary = summarize(reading);
    reading.spoken = this.spokenText(reading);
    return this.store.add(reading);
  }

  readOne(params = {}) {
    return this.read({ ...params, spread: 'one' });
  }

  readThree(params = {}) {
    return this.read({ ...params, spread: 'three' });
  }

  /** Short line for TTS: cards plus the essence, not the full essay. */
  spokenText(reading) {
    const parts = reading.cards.map((card) => {
      const position = card.position === 'Guidance' ? '' : `For the ${card.position.toLowerCase()}, `;
      return `${position}${card.name}${card.reversed ? ', reversed' : ''}`;
    });
    const who = reading.user && reading.user !== 'Guest' ? `${reading.user}, the cards see` : 'The cards see';
    return `${who}: ${parts.join('. ')}. ${reading.cards
      .map((card) => card.reversed ? card.meaning : card.meaning)
      .join(' ')
      .slice(0, 220)}`;
  }

  history(limit = 20) {
    return this.store.list(limit);
  }

  getReading(id) {
    return this.store.get(id);
  }

  clearHistory() {
    return this.store.clear();
  }

  historyCount() {
    return this.store.count();
  }
}

module.exports = {
  TarotEngine,
  ReadingStore,
  DECK,
  MAJOR_ARCANA,
  SUITS,
  RANKS,
  SPREADS,
  THEMES,
  ORIENTATIONS,
  normalizeSpread,
  normalizeTheme,
  describeCard,
  cleanText
};
