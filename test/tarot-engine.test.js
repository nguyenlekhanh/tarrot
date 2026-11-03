'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { TarotEngine, ReadingStore, DECK } = require('../tarot-engine');

function tempHistory() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mystic-tarot-'));
  return path.join(dir, 'tarot-history.json');
}

function seeded(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test('deck contains the full 78-card Rider-Waite set', () => {
  assert.equal(DECK.length, 78);
  assert.equal(DECK.filter((c) => c.arcana === 'major').length, 22);
  assert.equal(DECK.filter((c) => c.arcana === 'minor').length, 56);
  for (const suit of ['wands', 'cups', 'swords', 'pentacles']) {
    assert.equal(DECK.filter((c) => c.suit === suit).length, 14, `${suit} should have 14 cards`);
  }
  assert.equal(new Set(DECK.map((c) => c.id)).size, 78, 'card ids are unique');
  assert.equal(new Set(DECK.map((c) => c.name)).size, 78, 'card names are unique');
  for (const card of DECK) {
    assert.ok(card.upright && card.upright.length > 10, `${card.name} needs an upright meaning`);
    assert.ok(card.reversed && card.reversed.length > 10, `${card.name} needs a reversed meaning`);
    assert.ok(Array.isArray(card.keywords) && card.keywords.length >= 2);
  }
});

test('three-card spread draws Past, Present, Future with no duplicates', () => {
  const engine = new TarotEngine({ random: seeded(7), historyFile: tempHistory() });
  for (let i = 0; i < 300; i += 1) {
    const reading = engine.readThree({ question: 'What is coming?' });
    assert.equal(reading.cards.length, 3);
    assert.deepEqual(reading.positions, ['Past', 'Present', 'Future']);
    assert.deepEqual(reading.cards.map((c) => c.position), ['Past', 'Present', 'Future']);
    assert.equal(new Set(reading.cards.map((c) => c.id)).size, 3, 'no duplicate card ids in one spread');
  }
});

test('one-card spread draws a single Guidance card', () => {
  const engine = new TarotEngine({ random: seeded(3), historyFile: tempHistory() });
  const reading = engine.readOne({ question: 'Should I move?' });
  assert.equal(reading.cards.length, 1);
  assert.equal(reading.cards[0].position, 'Guidance');
  assert.equal(reading.spread, 'one');
});

test('both orientations occur and are reflected in the card payload', () => {
  const engine = new TarotEngine({ random: seeded(11), historyFile: tempHistory() });
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) {
    const [card] = engine.readOne().cards;
    seen.add(card.orientation);
    assert.equal(card.reversed, card.orientation === 'reversed');
    if (card.reversed) assert.notEqual(card.meaning, DECK.find((d) => d.id === card.id).upright);
  }
  assert.deepEqual([...seen].sort(), ['reversed', 'upright']);
});

test('each reading gets a unique id and is written to JSON history', () => {
  const file = tempHistory();
  const engine = new TarotEngine({ random: seeded(5), historyFile: file });
  const ids = new Set();
  for (let i = 0; i < 5; i += 1) {
    ids.add(engine.readThree({ question: `question ${i}` }).id);
  }
  assert.equal(ids.size, 5);
  assert.ok(fs.existsSync(file), 'history file is created');

  // A brand-new engine (simulating a server restart) sees the same readings.
  const revived = new TarotEngine({ random: seeded(9), historyFile: file });
  assert.equal(revived.historyCount(), 5);
  const [latest] = revived.history(1);
  assert.ok(ids.has(latest.id));
  assert.ok(Array.isArray(latest.cards) && latest.cards.length === 3);
  assert.ok(latest.createdAt);
});

test('history is capped and ordered newest-first', () => {
  const file = tempHistory();
  const engine = new TarotEngine({ random: seeded(13), historyFile: file, historyLimit: 10 });
  const stamp = [];
  for (let i = 0; i < 14; i += 1) stamp.push(engine.readOne({ question: `q${i}` }).id);
  const history = engine.history(20);
  assert.equal(history.length, 10);
  assert.equal(history[0].id, stamp[stamp.length - 1], 'newest reading first');
  assert.equal(engine.historyCount(), 10);
});

test('history survives a reload from disk and can be cleared', () => {
  const file = tempHistory();
  const engine = new TarotEngine({ random: seeded(17), historyFile: file });
  const reading = engine.readThree({ question: 'Career change?' });
  const reloaded = new ReadingStore({ file });
  assert.equal(reloaded.list(5).length, 1);
  assert.equal(reloaded.get(reading.id).id, reading.id);

  engine.clearHistory();
  const afterClear = new TarotEngine({ random: seeded(19), historyFile: file });
  assert.equal(afterClear.historyCount(), 0);
});

test('reading metadata is sanitized and interpretation is always present', () => {
  const engine = new TarotEngine({ random: seeded(23), historyFile: tempHistory() });
  const reading = engine.read({
    spread: 'three',
    theme: 'LOVE',
    question: '   Does   she\n love me?   ',
    user: '  Ava  ',
    uniqueId: 'AVA_1',
    source: 'chat',
    trigger: 'chat:love'
  });
  assert.equal(reading.theme, 'love');
  assert.equal(reading.question, 'Does she love me?');
  assert.equal(reading.user, 'Ava');
  assert.equal(reading.uniqueId, 'ava_1');
  assert.equal(reading.source, 'chat');
  for (const card of reading.cards) {
    assert.ok(card.interpretation.includes(card.name));
    assert.ok(card.interpretation.length > 40);
  }
  assert.ok(reading.summary.length > 20);
  assert.ok(reading.spoken.length > 20);
  assert.ok(reading.spoken.toLowerCase().includes('ava'));
});

test('unknown spread/theme values fall back to safe defaults', () => {
  const engine = new TarotEngine({ random: seeded(29), historyFile: tempHistory() });
  const reading = engine.read({ spread: 'bogus', theme: 'bogus' });
  assert.equal(reading.spread, 'three');
  assert.equal(reading.theme, 'general');
  assert.equal(reading.cards.length, 3);
});

test('card selection is independent of any interpretation layer', () => {
  // Two engines with the same seeded RNG must produce identical cards even
  // though one of them is asked to interpret a completely different theme.
  const a = new TarotEngine({ random: seeded(31), historyFile: tempHistory() });
  const b = new TarotEngine({ random: seeded(31), historyFile: tempHistory() });
  const first = a.readThree({ question: 'love?', theme: 'love' });
  const second = b.readThree({ question: 'money?', theme: 'career' });
  assert.deepEqual(first.cards.map((c) => c.id), second.cards.map((c) => c.id));
  assert.deepEqual(first.cards.map((c) => c.orientation), second.cards.map((c) => c.orientation));
  assert.notEqual(first.cards[0].interpretation, second.cards[0].interpretation);
});
