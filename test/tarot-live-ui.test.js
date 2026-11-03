'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { TtsQueue } = require('../public/js/tts-queue');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('the stage keeps the strict 1080x1920 portrait canvas', () => {
  const css = read('public/css/stage.css');
  assert.match(css, /width:\s*1080px;/);
  assert.match(css, /height:\s*1920px;/);
  assert.doesNotMatch(css, /aspect-ratio:\s*16\s*\/\s*9/);
  assert.doesNotMatch(read('public/index.html'), /aspect-ratio:\s*16\s*\/\s*9/);
});

test('the stage ships the queue, destiny, result and ticker boxes', () => {
  const html = read('public/index.html');
  for (const id of [
    'liveQueue', 'queueCurrent', 'queueCount', 'queueNext', 'queueMovement',
    'destinyBox', 'destinyColumns',
    'readingResult', 'resultHeadline', 'resultCards', 'fortuneBar', 'cautionBar',
    'fortuneValue', 'cautionValue', 'oracleText', 'resultClosing',
    'moveTicker', 'moveLineA', 'moveLineB'
  ]) {
    assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
  }
  assert.match(html, /CHOOSE YOUR DESTINY/);
  assert.match(html, /COMMENT \+ YOUR QUESTION/);
  assert.match(html, /THE ORACLE&#39;S MESSAGE/);
});

test('the new stage layer is loaded after the base stage styles', () => {
  const html = read('public/index.html');
  const base = html.indexOf('/css/stage.css');
  const extra = html.indexOf('/css/stage-tarot.css');
  assert.ok(base >= 0 && extra > base, 'stage-tarot.css must load after stage.css');
  assert.match(html, /<script src="\/js\/tts-queue.js"><\/script>/);
  const tts = html.indexOf('/js/tts-queue.js');
  const stage = html.indexOf('/js/stage.js');
  assert.ok(tts >= 0 && tts < stage, 'tts-queue.js must load before stage.js');
});

test('the stage controller renders every new box', () => {
  const js = read('public/js/stage.js');
  for (const marker of [
    'queueCurrent', 'queueNext', 'queueMovement', 'destinyColumns',
    'resultHeadline', 'resultCards', 'fortuneBar', 'oracleText',
    'pushMovement', 'applyTarotState'
  ]) {
    assert.ok(js.includes(marker), `stage.js missing ${marker}`);
  }
});

test('TTS clips play one at a time, in order, never overlapping', () => {
  const played = [];
  let active = 0;
  let peak = 0;
  const audios = [];
  const queue = new TtsQueue({
    limit: 8,
    create: (clip) => {
      const audio = {
        url: clip.url,
        play() {
          active += 1;
          peak = Math.max(peak, active);
          played.push(clip.url);
          return Promise.resolve();
        },
        pause() {},
        finish() {
          active -= 1;
          if (audio.onended) audio.onended();
        }
      };
      audios.push(audio);
      return audio;
    }
  });

  queue.push({ url: 'a.wav' });
  queue.push({ url: 'b.wav' });
  queue.push({ url: 'c.wav' });

  assert.deepEqual(played, ['a.wav']);
  assert.equal(queue.size, 2);
  assert.equal(queue.busy, true);

  audios[0].finish();
  assert.deepEqual(played, ['a.wav', 'b.wav']);
  audios[1].finish();
  assert.deepEqual(played, ['a.wav', 'b.wav', 'c.wav']);
  audios[2].finish();

  assert.equal(peak, 1);
  assert.equal(queue.busy, false);
  assert.equal(queue.size, 0);
  assert.equal(queue.total, 3);
});

test('the clip queue reports idle exactly once when it drains', () => {
  let idle = 0;
  const audios = [];
  const queue = new TtsQueue({
    create: () => {
      const audio = { play: () => Promise.resolve(), pause() {}, finish() { if (audio.onended) audio.onended(); } };
      audios.push(audio);
      return audio;
    },
    onIdle: () => { idle += 1; }
  });
  queue.push({ url: 'one.wav' });
  queue.push({ url: 'two.wav' });
  audios[0].finish();
  assert.equal(idle, 0);
  audios[1].finish();
  assert.equal(idle, 1);
});

test('the clip queue caps its backlog instead of growing without bound', () => {
  const audios = [];
  const queue = new TtsQueue({
    limit: 2,
    create: (clip) => {
      const audio = { url: clip.url, play: () => Promise.resolve(), pause() {}, finish() { if (audio.onended) audio.onended(); } };
      audios.push(audio);
      return audio;
    }
  });
  queue.push({ url: 'a' });
  queue.push({ url: 'b' });
  queue.push({ url: 'c' });
  queue.push({ url: 'd' });
  assert.equal(queue.size, 2);
  assert.equal(queue.dropped, 1);
  // 'a' is playing, 'b' was dropped to make room for 'd'.
  audios[0].finish();
  assert.equal(audios.length, 2);
  assert.equal(audios[1].url, 'c');
});

test('an empty clip is ignored and never blocks the queue', () => {
  const queue = new TtsQueue({ create: () => ({ play: () => Promise.resolve() }) });
  assert.equal(queue.push({}), false);
  assert.equal(queue.push(null), false);
  assert.equal(queue.size, 0);
});
