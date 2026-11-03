const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ENGINE_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'conversation.js'), 'utf8');
const CATALOG = require('../mystic-conversation');

/**
 * Loads public/js/conversation.js with a controllable clock and setInterval,
 * so the ambient scheduler can be driven tick by tick without waiting.
 */
function createHarness(options = {}) {
  let clock = 1_000_000;
  const timers = [];
  const spoken = [];
  const statuses = [];
  const records = [];

  class FakeDate extends Date {
    static now() {
      return clock;
    }
  }

  const sandbox = {
    window: {},
    console,
    Date: FakeDate,
    Math: Object.create(Math),
    JSON,
    Promise,
    Number,
    String,
    Boolean,
    Array,
    Set,
    Map,
    Object,
    RegExp,
    setInterval: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearInterval: () => {}
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(ENGINE_SOURCE, sandbox);

  const Engine = sandbox.window.MysticConversationEngine;
  const engine = new Engine({
    speak: (entry, text) => {
      spoken.push({ id: entry.id, text });
      if (typeof options.speakResult === 'function') return options.speakResult(entry, text);
      return { ok: true };
    },
    isBusy: () => (typeof options.isBusy === 'function' ? options.isBusy() : false),
    getContext: () => (typeof options.getContext === 'function' ? options.getContext() : { viewers: 0 }),
    onStatus: (status) => statuses.push(status),
    onRecord: (record) => records.push(record)
  });

  return {
    engine,
    spoken,
    statuses,
    records,
    advance(ms) {
      clock += ms;
    },
    tick() {
      return engine.tick();
    }
  };
}

const LINES = [
  { id: 'a1', category: 'ambient', text: 'The candles are lit.', contexts: ['any'], enabled: true },
  { id: 'a2', category: 'ambient', text: 'The moon is patient.', contexts: ['any'], enabled: true },
  { id: 'g1', category: 'greeting', text: 'Welcome, {viewer}.', contexts: ['newViewer'], enabled: true }
];

function snapshot(overrides = {}) {
  return {
    settings: {
      enabled: true,
      running: true,
      aiDialogue: false,
      interval: 60,
      shuffle: false,
      categories: {},
      ...(overrides.settings || {})
    },
    list: overrides.list || LINES,
    history: []
  };
}

test('mystic conversation: speaks only after the configured interval', () => {
  const h = createHarness();
  h.engine.applySnapshot(snapshot());
  h.advance(30_000);
  h.tick();
  assert.equal(h.spoken.length, 0, 'nothing is said before the interval elapses');

  h.advance(31_000);
  h.tick();
  assert.equal(h.spoken.length, 1, 'the Oracle speaks once the interval has passed');
  assert.ok(h.spoken[0].text.length > 0);
});

test('mystic conversation: never speaks while higher-priority speech is playing', () => {
  let busy = true;
  const h = createHarness({ isBusy: () => busy });
  h.engine.applySnapshot(snapshot());
  h.advance(90_000);
  h.tick();
  assert.equal(h.spoken.length, 0, 'ambient dialogue waits for the shared TTS queue');

  busy = false;
  h.tick();
  assert.equal(h.spoken.length, 1, 'it speaks again as soon as the queue is free');
});

test('mystic conversation: a tarot reading pauses ambient dialogue and it resumes afterwards', () => {
  const h = createHarness();
  h.engine.applySnapshot(snapshot());
  h.tick(); // fires immediately? no: interval not elapsed
  assert.equal(h.spoken.length, 0);

  h.advance(61_000);
  h.engine.notifyReading(true, 20_000);
  h.tick();
  assert.equal(h.spoken.length, 0, 'a reading silences the ambient dialogue');

  h.advance(25_000);
  h.tick();
  assert.equal(h.spoken.length, 0, 'still held while the reading owns the stage');

  h.engine.notifyReading(false);
  h.advance(5_000);
  h.tick();
  assert.equal(h.spoken.length, 1, 'dialogue resumes after the reading');
});

test('mystic conversation: gift and viewer moments take priority over ambient lines', () => {
  const h = createHarness();
  h.engine.applySnapshot(snapshot());
  h.advance(61_000);
  h.engine.notifyGift();
  h.tick();
  assert.equal(h.spoken.length, 0, 'a gift reaction holds the ambient scheduler back');

  h.advance(13_000);
  h.tick();
  assert.equal(h.spoken.length, 1, 'ambient dialogue returns after the gift hold');
});

test('mystic conversation: never overlaps its own lines', async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const h = createHarness({ speakResult: () => pending });
  h.engine.applySnapshot(snapshot());
  h.advance(61_000);
  h.tick();
  h.tick();
  assert.equal(h.spoken.length, 1, 'a second line is not started while one is speaking');

  release({ ok: true });
  await pending;
  await Promise.resolve();
  assert.equal(h.engine.speaking, false);
});

test('mystic conversation: does not repeat a line while fresh ones remain', async () => {
  const h = createHarness();
  h.engine.applySnapshot(snapshot());
  const seen = [];
  for (let i = 0; i < 2; i += 1) {
    h.advance(61_000);
    h.tick();
    seen.push(h.spoken[h.spoken.length - 1].id);
    // The engine records the line when the speak promise settles.
    await Promise.resolve();
    await Promise.resolve();
  }
  assert.equal(seen.length, 2);
  assert.notEqual(seen[0], seen[1], 'consecutive ambient lines differ');
});

test('mystic conversation: disabled categories are never scheduled', () => {
  const h = createHarness();
  h.engine.applySnapshot(
    snapshot({
      settings: { categories: { ambient: false } },
      list: LINES.filter((line) => line.category === 'ambient')
    })
  );
  h.advance(61_000);
  h.tick();
  assert.equal(h.spoken.length, 0, 'a disabled category is skipped');
});

test('mystic conversation: a disabled system is silent even with zero viewers', () => {
  const h = createHarness();
  h.engine.applySnapshot(snapshot({ settings: { enabled: false } }));
  h.advance(200_000);
  h.tick();
  assert.equal(h.spoken.length, 0);
});

test('mystic conversation: zero-viewer room still speaks', () => {
  const h = createHarness({ getContext: () => ({ viewers: 0 }) });
  h.engine.applySnapshot(snapshot());
  h.advance(61_000);
  h.tick();
  assert.equal(h.spoken.length, 1, 'the ambient Oracle talks to an empty room');
});

test('mystic conversation: recorded history carries the spoken line', () => {
  const h = createHarness();
  h.engine.applySnapshot(snapshot());
  h.advance(61_000);
  h.tick();
  return Promise.resolve().then(() => {
    assert.equal(h.records.length, 1);
    assert.equal(h.records[0].status, 'spoken');
    assert.ok(h.records[0].conversationId);
  });
});

test('mystic conversation: catalog is English, single-voice and free of the old café script', () => {
  const lines = CATALOG.defaultMysticLines();
  assert.equal(CATALOG.ORACLE_VOICE, 'af_alloy', 'the Oracle uses the Kokoro af_alloy voice');
  assert.equal(CATALOG.MYSTIC_CATEGORIES.length, 9);
  assert.ok(lines.length >= 40, 'there is enough dialogue for a long ambient stream');

  const categories = new Set(CATALOG.MYSTIC_CATEGORIES.map((category) => category.id));
  for (const line of lines) {
    assert.ok(categories.has(line.category), `${line.id} has a known category`);
    assert.ok(line.text.length > 10, `${line.id} has usable text`);
    assert.match(line.text, /^[\x20-\x7E]+$/, `${line.id} is plain English ASCII`);
  }

  const forbidden = /\b(coffee|lemonade|smoothie|slushie|drink|drinks|menu|cafe|café|sunny|seller|sellers|barista)\b/i;
  for (const line of lines) {
    assert.ok(!forbidden.test(line.text), `${line.id} does not mention the old shop script: ${line.text}`);
  }

  for (const id of ['welcome', 'story', 'tarot', 'engagement', 'reading', 'greeting', 'follow', 'gift', 'ambient']) {
    assert.ok(
      lines.some((line) => line.category === id),
      `the ${id} category has dialogue`
    );
  }
});
