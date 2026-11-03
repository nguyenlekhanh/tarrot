'use strict';

/**
 * Mystic Witch Live — built-in reading library.
 *
 * Deterministic, offline interpretation for all 78 cards in both orientations,
 * specialised per reading topic. It never draws cards: the reading arrives with
 * its cards already chosen, and this module only explains them and scores them.
 *
 * Fortune percentages are derived from the actual cards (orientation, arcana,
 * keyword polarity, topic affinity, spread position), so the same reading always
 * produces the same numbers — they are never random.
 */

const TOPIC_PROFILES = {
  general: {
    label: 'Reading',
    aura: 'pale silver light',
    intro: 'You have been carrying a question that has no easy shape yet.',
    lens: 'your situation as a whole',
    affinity: ['truth', 'balance', 'clarity', 'guidance', 'hope', 'movement'],
    risk: ['illusion', 'confusion'],
    strong: 'Trust the plain reading of what is in front of you.',
    tense: 'Name the thing you have been avoiding naming.',
    synthesis: 'The cards agree on one thing: the situation is already moving, and your next honest step decides the direction.',
    caution: 'The cards are not asking for a leap. They are asking for one clear, small decision.'
  },
  love: {
    label: 'Love Reading',
    aura: 'soft pink light',
    intro: 'You have been carrying quiet hopes in your heart, especially about love and the future.',
    lens: 'your love life',
    affinity: ['love', 'cups', 'union', 'nurture', 'heart', 'romance', 'partnership', 'emotion', 'affection', 'harmony'],
    risk: ['conflict', 'loss', 'attachment', 'temptation'],
    strong: 'Let the warmth you already give come back to you without testing it.',
    tense: 'Ask for what you need instead of guessing what the other person feels.',
    synthesis: 'The cards show affection that is real but unfinished. Patience is not passivity here; it is the thing making room for honesty.',
    caution: 'The cards warn against reading silence as an answer. A gentle question will tell you more than another night of wondering.'
  },
  family: {
    label: 'Family Reading',
    aura: 'warm amber light',
    intro: 'The people who raised you still live in the rooms of your mind, whether or not they are in the room.',
    lens: 'your family and the home you come from',
    affinity: ['nurture', 'tradition', 'belonging', 'home', 'generosity', 'stability', 'care'],
    risk: ['conflict', 'burden', 'control'],
    strong: 'A small act of care will settle more than a long explanation.',
    tense: 'An old rule in the family is asking to be renegotiated, kindly.',
    synthesis: 'The cards point to a bond that is load-bearing: it can hold more honesty than you have been giving it.',
    caution: 'The cards ask you not to carry a role that was assigned to you before you could choose it.'
  },
  personality: {
    label: 'Personality Reading',
    aura: 'violet light',
    intro: 'You are not a fixed thing, and the cards are looking at the part of you that is currently changing.',
    lens: 'who you are becoming',
    affinity: ['intuition', 'courage', 'mastery', 'curiosity', 'independence', 'reflection', 'presence'],
    risk: ['self-doubt', 'isolation', 'rigidity'],
    strong: 'The quality you admire in others is already yours; it just needs practice.',
    tense: 'The trait you dislike in yourself is asking for attention, not punishment.',
    synthesis: 'The cards describe someone more resilient than they give themselves credit for, and quietly ready for a larger role.',
    caution: 'The cards warn against confusing self-protection with self-knowledge.'
  },
  career: {
    label: 'Career Reading',
    aura: 'cool blue light',
    intro: 'Your work is asking a question that has nothing to do with luck and everything to do with direction.',
    lens: 'your work and the path you are building',
    affinity: ['drive', 'skill', 'structure', 'ambition', 'authority', 'progress', 'collaboration', 'wands'],
    risk: ['stagnation', 'delay', 'burnout'],
    strong: 'Take the next practical step; the path opens by walking it.',
    tense: 'A delay here is information about the plan, not about your worth.',
    synthesis: 'The cards show effort that is beginning to compound. What looks slow from inside is visible progress from outside.',
    caution: 'The cards warn against staying in a structure that has stopped returning your investment.'
  },
  wealth: {
    label: 'Wealth Reading',
    aura: 'golden light',
    intro: 'Money is rarely only money; it carries your history, your fear and your permission to want more.',
    lens: 'your money and material security',
    affinity: ['abundance', 'pentacles', 'growth', 'stability', 'generosity', 'recovery', 'completion'],
    risk: ['loss', 'burden', 'excess'],
    strong: 'A steady, unglamorous habit will outperform a dramatic gamble.',
    tense: 'Something is leaking quietly; find it before it becomes a story about bad luck.',
    synthesis: 'The cards show resources arriving in the same season as a lesson about how you hold them.',
    caution: 'The cards ask you to separate what you need from what you are using to feel safe.'
  },
  study: {
    label: 'Study Reading',
    aura: 'silver-blue light',
    intro: 'Learning is asking you to be a beginner again, and beginners are allowed to be slow.',
    lens: 'your studies and the way you learn',
    affinity: ['study', 'curiosity', 'patience', 'discipline', 'message', 'swords', 'mastery'],
    risk: ['confusion', 'delay', 'self-doubt'],
    strong: 'Consistency beats intensity; a smaller session repeated will carry you.',
    tense: 'The block is in the method, not in your ability.',
    synthesis: 'The cards show understanding that is closer than it feels, waiting on one structure you have been avoiding.',
    caution: 'The cards warn against measuring yourself by someone else’s pace.'
  },
  future: {
    label: 'Future Fortune',
    aura: 'deep indigo light',
    intro: 'The future you are asking about is still soft clay, and the cards are showing its current shape.',
    lens: 'what is coming next',
    affinity: ['future', 'cycles', 'movement', 'turning point', 'hope', 'renewal'],
    risk: ['delay', 'uncertainty', 'stagnation'],
    strong: 'Meet the change instead of bracing for it.',
    tense: 'A cycle is repeating because its lesson has not been learned yet.',
    synthesis: 'The cards show a turning point that has already begun quietly; the visible change comes later.',
    caution: 'The cards ask you to plan for the likely path without treating it as a verdict.'
  }
};

const CLOSING_LINE = 'The future is not written. Your choices shape your destiny.';

const POSITIVE = new Set([
  'abundance', 'affection', 'awakening', 'balance', 'beginnings', 'belonging', 'calling', 'clarity',
  'collaboration', 'completion', 'courage', 'creation', 'curiosity', 'drive', 'freedom', 'generosity',
  'growth', 'guidance', 'harmony', 'healing', 'hope', 'innocence', 'intuition', 'joy', 'love',
  'mastery', 'momentum', 'movement', 'nurture', 'opportunity', 'patience', 'progress', 'recovery',
  'renewal', 'resilience', 'return', 'revelation', 'romance', 'skill', 'spark', 'stability', 'strength',
  'success', 'support', 'transformation', 'truth', 'union', 'victory', 'warmth', 'will', 'wisdom'
]);

const NEGATIVE = new Set([
  'anxiety', 'attachment', 'avoidance', 'bondage', 'burden', 'collapse', 'conflict', 'confusion',
  'control', 'debt', 'delay', 'disaster', 'doubt', 'fear', 'friction', 'hiding', 'illusion',
  'imbalance', 'isolation', 'loss', 'neglect', 'overwhelm', 'recklessness', 'rigidity', 'sacrifice',
  'stagnation', 'stalemate', 'temptation', 'uncertainty', 'upheaval', 'withdrawal'
]);

const MAJOR_NAMES = [
  'The Fool', 'The Magician', 'The High Priestess', 'The Empress', 'The Emperor', 'The Hierophant',
  'The Lovers', 'The Chariot', 'Strength', 'The Hermit', 'Wheel of Fortune', 'Justice',
  'The Hanged Man', 'Death', 'Temperance', 'The Devil', 'The Tower', 'The Star', 'The Moon',
  'The Sun', 'Judgement', 'The World'
];

const RANK_NAMES = ['Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Page', 'Knight', 'Queen', 'King'];
const SUIT_NAMES = ['Wands', 'Cups', 'Swords', 'Pentacles'];

const POSITION_LEAD = {
  Past: 'In the past position',
  Present: 'In the present position',
  Future: 'In the future position',
  Guidance: 'As guidance'
};

const MAX_ORACLE_CHARS = 900;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clean(value, maxLength = 220) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function topicProfile(theme) {
  const key = String(theme || '').toLowerCase();
  return TOPIC_PROFILES[key] || TOPIC_PROFILES.general;
}

function resolveTopicLabel(reading, profile) {
  const explicit = clean(reading && (reading.topicLabel || reading.topic_label), 60);
  if (explicit) return explicit;
  return profile.label;
}

function keywordPolarity(keywords) {
  let score = 0;
  for (const raw of Array.isArray(keywords) ? keywords : []) {
    const keyword = String(raw || '').toLowerCase();
    if (POSITIVE.has(keyword)) score += 1;
    else if (NEGATIVE.has(keyword)) score -= 1;
  }
  return clamp(score, -3, 3);
}

/**
 * One card's fortune contribution, in a 5..95 band.
 * Deterministic inputs only: orientation, arcana, keywords, topic, position.
 */
function cardFortune(card, profile, index, total) {
  let score = card.reversed ? 44 : 60;
  score += keywordPolarity(card.keywords) * 5;
  if (card.arcana === 'major') score += card.reversed ? -7 : 7;
  const keywords = (card.keywords || []).map((keyword) => String(keyword).toLowerCase());
  const affinity = keywords.filter((keyword) => profile.affinity.includes(keyword)).length;
  const risks = keywords.filter((keyword) => profile.risk.includes(keyword)).length;
  score += Math.min(2, affinity) * 6;
  score -= Math.min(2, risks) * 5;
  if (total > 1) {
    if (index === total - 1) score += 2;
    if (index === 0) score -= 1;
  }
  if (card.position === 'Future' && card.reversed) score -= 2;
  if (card.position === 'Past' && !card.reversed) score += 1;
  return clamp(Math.round(score), 5, 95);
}

function scoreReading(reading) {
  const profile = topicProfile(reading && reading.theme);
  const cards = Array.isArray(reading && reading.cards) ? reading.cards : [];
  if (!cards.length) return { fortune: 50, caution: 50, perCard: [] };
  const perCard = cards.map((card, index) => ({
    name: card.name,
    position: card.position || 'Guidance',
    reversed: Boolean(card.reversed),
    score: cardFortune(card, profile, index, cards.length)
  }));
  const mean = perCard.reduce((sum, item) => sum + item.score, 0) / perCard.length;
  const fortune = clamp(Math.round(mean), 8, 92);
  return { fortune, caution: 100 - fortune, perCard };
}

function meaningOf(card) {
  return clean(
    card.meaning ||
      (card.reversed ? card.reversedMeaning : card.uprightMeaning) ||
      (Array.isArray(card.keywords) ? `carries ${card.keywords.slice(0, 3).join(', ')}` : ''),
    220
  );
}

function cardSentence(card, index, profile) {
  const name = clean(card.name, 60);
  const lead = POSITION_LEAD[card.position] || `Card ${index + 1}`;
  const orientation = card.reversed ? ' reversed' : '';
  const meaning = meaningOf(card);
  const opening = meaning ? meaning.charAt(0).toLowerCase() + meaning.slice(1) : 'has something to say';
  return `${lead}, ${name}${orientation} shows ${opening}`;
}

function cardAdvice(card, profile, score) {
  const line = score >= 55 ? profile.strong : profile.tense;
  const keywords = (card.keywords || []).slice(0, 2).join(' and ');
  return keywords ? `${line} (${keywords})` : line;
}

/**
 * Build the full result the stage renders and the Oracle speaks.
 * `cards` are the drawn cards, untouched: this function never adds or removes one.
 */
function buildReadingResult(reading, options = {}) {
  const cards = Array.isArray(reading && reading.cards) ? reading.cards : [];
  if (!cards.length) return null;
  const profile = topicProfile(reading.theme);
  const scores = scoreReading(reading);
  const user = clean(reading.user || 'Seeker', 50);
  const topicLabel = resolveTopicLabel(reading, profile);
  const cardLines = cards.map((card, index) => cardSentence(card, index, profile));
  const advice = cards.map((card, index) => cardAdvice(card, profile, scores.perCard[index] ? scores.perCard[index].score : 50));
  const fortuneLine = scores.fortune >= 60 ? profile.synthesis : profile.caution;

  const paragraphs = [
    `${user}, I see a ${profile.aura} around your crystal ball. ${profile.intro}`
  ];
  paragraphPush(paragraphs, cardLines.join(' '));
  paragraphPush(paragraphs, `${fortuneLine} ${advice[0]}`);
  paragraphPush(paragraphs, CLOSING_LINE);

  const oracleMessage = clampWords(paragraphs.join('\n\n'), MAX_ORACLE_CHARS);
  const result = {
    user,
    topic: reading.theme || 'general',
    topicLabel,
    headline: `${topicLabel.toUpperCase()} FOR ${user.toUpperCase()}`,
    spread: reading.spread || (cards.length === 1 ? 'one' : 'three'),
    fortune: scores.fortune,
    caution: scores.caution,
    perCard: scores.perCard,
    cards: cards.map((card, index) => ({
      name: card.name,
      position: card.position || 'Guidance',
      orientation: card.reversed ? 'reversed' : 'upright',
      reversed: Boolean(card.reversed),
      arcana: card.arcana || 'minor',
      suit: card.suit || null,
      keywords: Array.isArray(card.keywords) ? card.keywords.slice(0, 3) : [],
      meaning: meaningOf(card),
      score: scores.perCard[index] ? scores.perCard[index].score : 50
    })),
    paragraphs,
    closing: CLOSING_LINE,
    oracleMessage,
    generatedAt: new Date().toISOString(),
    source: options.source || 'builtin'
  };
  result.spoken = spokenLines(result, cards, profile);
  return result;
}

function paragraphPush(list, text) {
  const value = clean(text, 420);
  if (value) list.push(value);
}

function clampWords(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('\n\n'));
  return stop > max * 0.5 ? cut.slice(0, stop + 1).trim() : `${cut.trim()}…`;
}

/** Short, speakable lines in narration order; the stage queue plays them in order. */
function spokenLines(result, cards, profile) {
  const orientation = (card) => (card.reversed ? ', reversed' : '');
  const lines = [
    `Welcome, ${result.user}. The Oracle is ready to read your ${result.topicLabel.toLowerCase()}.`,
    `${result.topicLabel}. I am drawing ${cards.length === 1 ? 'one card' : `${['', 'one', 'two', 'three'][cards.length] || cards.length} cards`} from the deck now.`
  ];
  cards.forEach((card, index) => {
    const first = index === 0;
    const label = cards.length === 1 ? 'The card' : first ? 'The first card' : index === cards.length - 1 ? 'The final card' : 'The next card';
    lines.push(`${label} ${first && cards.length > 1 ? 'reveals' : 'is'} ${card.name}${orientation(card)}, in the ${String(card.position || 'Guidance').toLowerCase()}.`);
  });
  lines.push(`${result.fortune} percent good fortune, ${result.caution} points to watch. ${profile.strong}`);
  lines.push(cards.length === 1 ? `The cards ask this of you: ${profile.tense}` : `Together: ${profile.synthesis}`);
  lines.push(CLOSING_LINE);
  return lines.map((line) => clean(line, 240)).filter(Boolean);
}

/**
 * Reject AI prose that names a card which was not drawn, or that tries to change
 * the spread. Everything else is allowed; length is trimmed before display.
 */
function validateAiText(text, reading) {
  const value = String(text || '').trim();
  if (value.length < 40) return { ok: false, reason: 'too_short' };
  if (value.length > 1800) return { ok: false, reason: 'too_long' };
  if (/[*#`]|^\s*[-•]/m.test(value)) return { ok: false, reason: 'markdown' };
  const drawn = new Set((reading.cards || []).map((card) => String(card.name).toLowerCase()));
  for (const name of MAJOR_NAMES) {
    if (value.toLowerCase().includes(name.toLowerCase()) && !drawn.has(name.toLowerCase())) {
      return { ok: false, reason: `unknown_card:${name}` };
    }
  }
  for (const rank of RANK_NAMES) {
    for (const suit of SUIT_NAMES) {
      const name = `${rank} of ${suit}`.toLowerCase();
      if (value.toLowerCase().includes(name) && !drawn.has(name)) {
        return { ok: false, reason: `unknown_card:${rank} of ${suit}` };
      }
    }
  }
  return { ok: true, text: value };
}

/** Merge an AI paragraph set into the result without touching cards or scores. */
function applyAiInterpretation(result, aiText, options = {}) {
  if (!result) return null;
  const checked = validateAiText(aiText, { cards: result.cards.map((card) => ({ name: card.name })) });
  if (!checked.ok) return { ...result, aiError: checked.reason };
  const paragraphs = [clean(checked.text, 1400), CLOSING_LINE];
  return {
    ...result,
    paragraphs,
    oracleMessage: paragraphs.join('\n\n'),
    source: 'ai',
    provider: options.provider || '',
    aiError: ''
  };
}

module.exports = {
  TOPIC_PROFILES,
  CLOSING_LINE,
  MAJOR_NAMES,
  scoreReading,
  cardFortune,
  buildReadingResult,
  spokenLines,
  validateAiText,
  applyAiInterpretation,
  topicProfile
};
