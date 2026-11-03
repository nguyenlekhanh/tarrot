'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DECK, MAJOR_ARCANA } = require('../tarot-engine');
const {
  CLOSING_LINE,
  buildReadingResult,
  scoreReading,
  validateAiText,
  applyAiInterpretation
} = require('../tarot-reading-library');

const POSITIONS = ['Past', 'Present', 'Future'];

function card(cardData, reversed = false, position = 'Guidance') {
  return {
    ...cardData,
    position,
    orientation: reversed ? 'reversed' : 'upright',
    reversed,
    meaning: reversed ? cardData.reversed : cardData.upright
  };
}

function reading(cards, theme = 'general', user = 'Emily') {
  return {
    user,
    theme,
    topicLabel: '',
    question: 'What do the cards see?',
    spread: cards.length === 1 ? 'one' : 'three',
    cards
  };
}

test('every one of the 78 cards produces a complete reading', () => {
  assert.equal(DECK.length, 78);
  for (const cardData of DECK) {
    const result = buildReadingResult(reading([card(cardData)]));
    assert.ok(result, `no result for ${cardData.name}`);
    assert.equal(result.cards[0].name, cardData.name);
    assert.ok(result.fortune >= 8 && result.fortune <= 92, `fortune out of range for ${cardData.name}`);
    assert.equal(result.fortune + result.caution, 100);
    assert.ok(result.oracleMessage.includes(cardData.name), `oracle omitted ${cardData.name}`);
    assert.ok(result.oracleMessage.includes(CLOSING_LINE));
    assert.ok(result.spoken.length >= 6);
  }
});

test('reversed cards are reported as reversed and use the reversed meaning', () => {
  const star = DECK.find((entry) => entry.name === 'The Star');
  const result = buildReadingResult(reading([card(star, true)]));
  assert.equal(result.cards[0].orientation, 'reversed');
  assert.equal(result.cards[0].reversed, true);
  assert.equal(result.cards[0].meaning, star.reversed);
  assert.match(result.oracleMessage, /The Star reversed/);
});

test('the same cards always produce the same percentages', () => {
  const cards = [
    card(DECK[0], false, 'Past'),
    card(DECK[10], true, 'Present'),
    card(DECK[20], false, 'Future')
  ];
  const first = buildReadingResult(reading(cards, 'love'));
  const second = buildReadingResult(reading(cards, 'love'));
  assert.equal(first.fortune, second.fortune);
  assert.equal(first.caution, second.caution);
  assert.equal(first.oracleMessage, second.oracleMessage);
  assert.deepEqual(first.perCard, second.perCard);
});

test('a reversed card scores lower than the same upright card', () => {
  const star = DECK.find((entry) => entry.name === 'The Star');
  const upright = scoreReading(reading([card(star, false)])).fortune;
  const reversed = scoreReading(reading([card(star, true)])).fortune;
  assert.ok(reversed < upright, `${reversed} should be below ${upright}`);
});

test('the topic changes the score for a topic-relevant card', () => {
  const synthetic = {
    id: 'test-cups',
    name: 'Ace of Cups',
    arcana: 'minor',
    suit: 'cups',
    keywords: ['love', 'cups', 'affection', 'beginning'],
    upright: 'A raw beginning in emotion, love and intuition.',
    reversed: 'A start blocked in emotion, love and intuition.'
  };
  const love = scoreReading(reading([card(synthetic)], 'love')).fortune;
  const career = scoreReading(reading([card(synthetic)], 'career')).fortune;
  assert.ok(love > career, `love ${love} should beat career ${career}`);
});

test('the result carries the username, topic and cards in order', () => {
  const cards = [
    card(DECK[1], false, 'Past'),
    card(DECK[2], true, 'Present'),
    card(DECK[3], false, 'Future')
  ];
  const result = buildReadingResult({ ...reading(cards, 'career', 'Maya'), topicLabel: 'Career Reading' });
  assert.equal(result.headline, 'CAREER READING FOR MAYA');
  assert.deepEqual(result.cards.map((entry) => entry.position), ['Past', 'Present', 'Future']);
  assert.equal(result.cards.length, 3);
  assert.equal(result.topicLabel, 'Career Reading');
  assert.ok(result.oracleMessage.startsWith('Maya,'));
});

test('AI text that invents a card is rejected', () => {
  const drawn = reading([card(DECK[0])]);
  const foreign = drawn.cards[0].name === 'The Tower' ? 'The Star' : 'The Tower';
  const invalid = validateAiText(
    `${foreign} is standing behind you tonight, and it asks you to keep walking forward with patience.`,
    drawn
  );
  assert.equal(invalid.ok, false);
  assert.match(invalid.reason, /unknown_card/);
});

test('AI text with markdown or too little prose is rejected', () => {
  const drawn = reading([card(DECK[0])]);
  assert.equal(validateAiText('**bold** claim about your future and the road ahead of you.', drawn).ok, false);
  assert.equal(validateAiText('short.', drawn).ok, false);
});

test('valid AI prose is merged without touching the drawn cards', () => {
  const drawn = reading([card(DECK[18], false, 'Future')]);
  const name = drawn.cards[0].name;
  const text = `${name} sits in your future, and it is asking for patience rather than a decision tonight. ` +
    'The light around your question is steady, so let the next week answer for you.';
  const base = buildReadingResult(drawn);
  const merged = applyAiInterpretation(base, text, { provider: 'ollama' });
  assert.equal(merged.source, 'ai');
  assert.equal(merged.provider, 'ollama');
  assert.deepEqual(merged.cards, base.cards);
  assert.equal(merged.fortune, base.fortune);
  assert.ok(merged.oracleMessage.includes(text));
  assert.ok(merged.oracleMessage.includes(CLOSING_LINE));
});

test('a failed AI merge leaves the built-in result usable', () => {
  const simulation = reading([card(DECK[4])]);
  const base = buildReadingResult(simulation);
  const merged = applyAiInterpretation(base, 'nope', { provider: 'openrouter' });
  assert.notEqual(merged.source, 'ai');
  assert.ok(merged.aiError);
  assert.equal(merged.oracleMessage, base.oracleMessage);
});

test('the spoken script follows the reading sequence', () => {
  const cards = [card(DECK[6], false, 'Past'), card(DECK[7], true, 'Present'), card(DECK[13], false, 'Future')];
  const result = buildReadingResult(reading(cards, 'love', 'Emily'));
  assert.match(result.spoken[0], /^Welcome, Emily\. The Oracle is ready to read your/);
  assert.match(result.spoken[1], /drawing three cards/);
  assert.match(result.spoken[2], /^The first card reveals The Lovers/);
  assert.match(result.spoken[3], /reversed/);
  assert.match(result.spoken[4], /^The final card is Death/);
  assert.ok(result.spoken.some((line) => line.includes(`${result.fortune} percent good fortune`)));
  assert.equal(result.spoken[result.spoken.length - 1], CLOSING_LINE);
});

test('all 22 Major Arcana are recognised for AI card validation', () => {
  assert.equal(MAJOR_ARCANA.length, 22);
  const drawn = reading([card(DECK[0])]);
  const invalid = validateAiText(
    `The World is turning slowly above you and the Wheel of Fortune is turning with it.`,
    drawn
  );
  assert.equal(invalid.ok, false);
});
