'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { cardMarkup, resultCardMarkup, resultCardsMarkup } = require('../public/js/tarot-card-view');
const { ReadingResetTimer } = require('../public/js/reading-reset');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const upright = { name: 'The Star', position: 'Outcome', reversed: false, arcana: 'major', keywords: ['hope', 'renewal'] };
const reversed = { name: 'Two of Swords', position: 'Guidance', reversed: true, arcana: 'minor', suit: 'swords', keywords: ['choice', 'blocked', 'stalemate'] };
const third = { name: 'Ace of Cups', position: 'Heart', reversed: false, arcana: 'minor', suit: 'cups', keywords: ['love'] };

function artLayer(html) {
  const match = html.match(/<div class="card-art">([\s\S]*?)<\/div>/);
  return match ? { inner: match[1], index: match.index } : null;
}

function fakeClock() {
  let now = 0;
  let seq = 1;
  const timers = new Map();
  return {
    timers: {
      set: (fn, ms) => {
        const id = seq++;
        timers.set(id, { at: now + (Number(ms) || 0), fn });
        return id;
      },
      clear: (id) => { timers.delete(id); }
    },
    advance(ms) {
      now += ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= now)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) return;
        timers.delete(due[0]);
        due[1].fn();
      }
    },
    get count() { return timers.size; }
  };
}

// --------------------------------------------------------------- card markup

test('a reversed card rotates its artwork, never its text', () => {
  const html = cardMarkup(reversed);
  assert.match(html, /class="card-face reversed-card"/);
  const art = artLayer(html);
  assert.ok(art, 'the artwork layer is missing');
  assert.match(art.inner, /card-sigil/);
  assert.doesNotMatch(art.inner, /card-name|card-position|card-orientation|card-keywords|Two of Swords/);
  for (const marker of ['card-position', 'card-name', 'card-orientation', 'card-keywords']) {
    const index = html.indexOf(`class="${marker}`);
    assert.ok(index > 0, `${marker} is missing`);
    assert.ok(!art.inner.includes(marker), `${marker} must sit outside the rotated art layer`);
  }
  // The name, orientation and keywords all follow the art layer, so the only
  // node inside the rotation is the artwork itself.
  for (const marker of ['card-name', 'card-orientation', 'card-keywords']) {
    assert.ok(html.indexOf(`class="${marker}`) > art.index + art.inner.length);
  }
  assert.match(html, /class="card-orientation reversed">REVERSED</);
  // Rotation is CSS-only: the markup never carries a transform.
  assert.doesNotMatch(html, /rotate|transform/);
});

test('an upright card has no reversal class and keeps the same layers', () => {
  const html = cardMarkup(upright);
  assert.match(html, /class="card-face"/);
  assert.doesNotMatch(html, /reversed-card/);
  assert.match(html, /class="card-orientation">UPRIGHT</);
  assert.ok(artLayer(html));
  assert.match(html, /The Star/);
  assert.match(html, /hope · renewal/);
});

test('a one-card reading renders one card with readable text', () => {
  const html = cardMarkup(upright);
  assert.equal((html.match(/class="card-slot"/g) || []).length, 1);
  assert.equal((html.match(/class="card-art"/g) || []).length, 1);
  assert.equal((html.match(/class="card-name"/g) || []).length, 1);
});

test('a three-card reading renders three cards, upright and reversed mixed', () => {
  const cards = [upright, reversed, third];
  const html = cards.map(cardMarkup).join('');
  assert.equal((html.match(/class="card-slot"/g) || []).length, 3);
  assert.equal((html.match(/class="card-art"/g) || []).length, 3);
  assert.equal((html.match(/reversed-card/g) || []).length, 1);
  assert.match(html, /The Star/);
  assert.match(html, /Two of Swords/);
  assert.match(html, /Ace of Cups/);
  for (const card of cards) {
    const single = cardMarkup(card);
    const art = artLayer(single);
    const nameIndex = single.indexOf('class="card-name"');
    assert.ok(nameIndex > art.index + art.inner.length);
  }
});

test('the result card keeps its name upright for a reversed draw', () => {
  const html = resultCardMarkup(reversed);
  assert.match(html, /result-card is-reversed/);
  const art = html.match(/<div class="result-card-art">([\s\S]*?)<\/div>/);
  assert.ok(art);
  assert.doesNotMatch(art[1], /Two of Swords|GUIDANCE|REVERSED/);
  assert.match(html, /Two of Swords/);
  assert.match(html, /REVERSED/);
  const all = resultCardsMarkup([upright, reversed, third]);
  assert.equal((all.match(/class="result-card(?: is-reversed)?"/g) || []).length, 3);
});

test('the stylesheet rotates only the art layers', () => {
  const css = read('public/css/stage.css');
  const tarot = read('public/css/stage-tarot.css');
  assert.match(css, /\.card-face \{[\s\S]*?transform: rotateY\(180deg\);/);
  assert.match(css, /\.card-face\.reversed-card \.card-art \{ transform: rotate\(180deg\); \}/);
  assert.doesNotMatch(css, /\.card-face\.reversed-card\s*\{/);
  assert.match(tarot, /\.result-card\.is-reversed \.result-card-art \{ transform: rotate\(180deg\); \}/);
  assert.doesNotMatch(tarot, /\.result-card\.is-reversed\s*\{[^}]*rotate\(/);
});

// ------------------------------------------------------------- reset timing

test('the reset waits for the queue to drain and then the delay', () => {
  const clock = fakeClock();
  const fired = [];
  const timer = new ReadingResetTimer({
    delayMs: 3000,
    timers: clock.timers,
    isQueueIdle: () => true,
    onReset: (id) => fired.push(id)
  });

  timer.begin('r1');
  timer.heardClip('r1');
  clock.advance(2999);
  assert.deepEqual(fired, []);

  timer.queueIdle();
  clock.advance(2999);
  assert.deepEqual(fired, [], 'the delay has not elapsed yet');
  clock.advance(1);
  assert.deepEqual(fired, ['r1']);
  assert.equal(timer.pending, false);
  assert.equal(clock.count, 0);
});

test('a busy clip queue blocks the reset until it reports idle', () => {
  const clock = fakeClock();
  const fired = [];
  let idle = false;
  const timer = new ReadingResetTimer({
    delayMs: 3000,
    timers: clock.timers,
    isQueueIdle: () => idle,
    onReset: (id) => fired.push(id)
  });

  timer.begin('r1');
  timer.heardClip('r1');
  assert.equal(timer.queueIdle(), false);
  clock.advance(10000);
  assert.deepEqual(fired, []);

  idle = true;
  timer.queueIdle();
  clock.advance(3000);
  assert.deepEqual(fired, ['r1']);
});

test('the delay is configurable', () => {
  const clock = fakeClock();
  const fired = [];
  const timer = new ReadingResetTimer({
    delayMs: () => 750,
    timers: clock.timers,
    onReset: (id) => fired.push(id)
  });
  timer.begin('r1');
  timer.heardClip('r1');
  timer.queueIdle();
  clock.advance(749);
  assert.deepEqual(fired, []);
  clock.advance(1);
  assert.deepEqual(fired, ['r1']);
});

test('generating TTS is not completion: no clip means the queue is never armed', () => {
  const clock = fakeClock();
  const fired = [];
  const timer = new ReadingResetTimer({
    delayMs: 3000,
    fallbackMs: 25000,
    timers: clock.timers,
    isQueueIdle: () => true,
    onReset: (id) => fired.push(id)
  });

  timer.begin('r1');
  // The server produced files but the stage never queued or played them.
  assert.equal(timer.queueIdle(), false);
  clock.advance(20000);
  assert.deepEqual(fired, [], 'nothing may reset before the audio has played');
});

test('a reading with no narration still resets, but only when the queue is quiet', () => {
  const clock = fakeClock();
  const fired = [];
  let idle = false;
  const timer = new ReadingResetTimer({
    delayMs: 3000,
    fallbackMs: 25000,
    timers: clock.timers,
    isQueueIdle: () => idle,
    onReset: (id) => fired.push(id)
  });

  timer.begin('r1');
  clock.advance(25000);
  assert.deepEqual(fired, [], 'a busy queue keeps the cards on the table');
  idle = true;
  timer.queueIdle();
  clock.advance(3000);
  assert.deepEqual(fired, ['r1']);
});

test('a new reading cancels the pending reset and only that reading resets', () => {
  const clock = fakeClock();
  const fired = [];
  const timer = new ReadingResetTimer({
    delayMs: 3000,
    timers: clock.timers,
    isQueueIdle: () => true,
    onReset: (id) => fired.push(id)
  });

  timer.begin('r1');
  timer.heardClip('r1');
  timer.queueIdle();
  clock.advance(1000);

  timer.begin('r2');
  clock.advance(10000);
  assert.deepEqual(fired, [], 'the old reset must not interrupt the new reading');

  assert.equal(timer.heardClip('r1'), false, 'a stale clip cannot arm the new reading');
  timer.heardClip('r2');
  timer.queueIdle();
  clock.advance(3000);
  assert.deepEqual(fired, ['r2']);
});

test('consecutive readings each reset once', () => {
  const clock = fakeClock();
  const fired = [];
  const timer = new ReadingResetTimer({
    delayMs: 3000,
    timers: clock.timers,
    onReset: (id) => fired.push(id)
  });

  for (const id of ['r1', 'r2', 'r3']) {
    timer.begin(id);
    timer.heardClip(id);
    timer.queueIdle();
    clock.advance(3000);
  }
  assert.deepEqual(fired, ['r1', 'r2', 'r3']);
});

test('cancel drops a pending reset without firing it', () => {
  const clock = fakeClock();
  const fired = [];
  const timer = new ReadingResetTimer({
    delayMs: 3000,
    timers: clock.timers,
    onReset: (id) => fired.push(id)
  });
  timer.begin('r1');
  timer.heardClip('r1');
  timer.queueIdle();
  timer.cancel();
  clock.advance(10000);
  assert.deepEqual(fired, []);
  assert.equal(timer.pending, false);
});

// ------------------------------------------------------------ stage wiring

test('the stage wires the reset to real playback, not to the RPC reply', () => {
  const js = read('public/js/stage.js');
  assert.match(js, /new window\.ReadingResetTimer\(/);
  assert.match(js, /if \(readingReset\) readingReset\.begin\(currentReadingId\);/);
  assert.match(js, /if \(readingReset\) readingReset\.heardClip\(p\.readingId\);/);
  assert.match(js, /if \(readingReset\) readingReset\.queueIdle\(\);/);
  assert.match(js, /classList\.remove\('revealed'\)/);
  assert.match(js, /function cardResetDelayMs\(\)/);
  assert.match(js, /return 3000;/);
  assert.match(js, /readingGeneration \+= 1/);
  // Music ducking and the single shared clip queue are untouched.
  assert.match(js, /music\.setDuck\(playing \|\| size > 0\)/);
  assert.equal((js.match(/new window\.TtsQueue\(/g) || []).length, 1);
});

test('the stage loads the card and reset modules before the controller', () => {
  const html = read('public/index.html');
  const card = html.indexOf('/js/tarot-card-view.js');
  const reset = html.indexOf('/js/reading-reset.js');
  const stage = html.indexOf('/js/stage.js');
  assert.ok(card > 0 && reset > 0 && stage > 0);
  assert.ok(card < stage && reset < stage, 'modules must load before stage.js');
  assert.ok(html.indexOf('/js/tts-queue.js') < reset);
});
