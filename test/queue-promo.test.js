'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { hasWaiting, promoVisible, waitingCount } = require('../public/js/queue-promo');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function movementBlock() {
  const html = read('public/index.html');
  const start = html.indexOf('id="queueMovement"');
  const end = html.indexOf('id="destinyBox"');
  assert.ok(start > 0 && end > start, 'the movement row must sit above the destiny box');
  return html.slice(start, end);
}

// ------------------------------------------------------------- empty rule

test('the promotion owns the row only while nobody is waiting', () => {
  assert.equal(promoVisible({ count: 0 }), true);
  assert.equal(promoVisible({ count: 0, total: 0, lines: {} }), true);
  assert.equal(promoVisible({}), true);
  assert.equal(promoVisible(null), true);
  assert.equal(promoVisible({ count: 1 }), false);
  assert.equal(promoVisible({ count: '1' }), false);
  assert.equal(promoVisible({ count: 87 }), false);
});

test('a waiting count is read defensively', () => {
  assert.equal(hasWaiting({ count: 2 }), true);
  assert.equal(hasWaiting({ count: 0 }), false);
  assert.equal(waitingCount({ count: -4 }), 0);
  assert.equal(waitingCount({ count: 'x' }), 0);
  assert.equal(waitingCount(undefined), 0);
  assert.equal(waitingCount({ count: 3 }), 3);
});

// --------------------------------------------------------------- the line

test('one horizontal line with the real rose artwork', () => {
  const block = movementBlock();
  assert.match(block, /class="queue-promo" id="queuePromo"/);
  assert.match(block, /<img class="queue-icon" src="\/assets\/gift_icon\/rose\.webp"/);
  assert.match(block, /1 Rose = Move Up 1 Position/);
  assert.match(block, /100 Likes = Move Up 1 Position/);
  assert.match(block, /FREE TAROT READING/);
  assert.equal((block.match(/class="queue-promo-sep"/g) || []).length, 2);
  // No emoji rose where the artwork exists, and no forced line break.
  assert.doesNotMatch(block, /🌹/);
  assert.doesNotMatch(block, /<br\s*\/?>/i);
  // There is no heart image asset, so the heart stays an emoji.
  assert.match(block, /❤️/);
  assert.match(block, /🔮/);
});

test('the rose asset ships with the stage', () => {
  const asset = path.join(root, 'public/assets/gift_icon/rose.webp');
  assert.ok(fs.existsSync(asset), 'rose.webp is missing');
  assert.ok(fs.statSync(asset).size > 1000, 'rose.webp looks empty');
});

test('the old quiet-line copy is gone from the stage', () => {
  assert.doesNotMatch(read('public/index.html'), /THE LINE IS QUIET TONIGHT/i);
  assert.doesNotMatch(read('public/js/stage.js'), /THE LINE IS QUIET TONIGHT/i);
  assert.doesNotMatch(read('tarot-queue.js'), /THE LINE IS QUIET TONIGHT/i);
  assert.doesNotMatch(read('server.js'), /THE LINE IS QUIET TONIGHT/i);
  assert.doesNotMatch(read('README.md'), /THE LINE IS QUIET TONIGHT/i);
  // Neither snapshot ever invents placeholder copy: the promotion is markup.
  assert.match(read('tarot-queue.js'), /recent: this\.recent\[0\] \? this\.recent\[0\]\.message : '',/);
  assert.match(read('server.js'), /const recent = snapshot\.recent\[0\] \? snapshot\.recent\[0\]\.message : '';/);
});

test('the promotion stays centred on one line at any width', () => {
  const css = read('public/css/stage-tarot.css');
  const rule = css.match(/\.queue-promo \{([\s\S]*?)\}/);
  assert.ok(rule, 'missing .queue-promo');
  assert.match(rule[1], /display: flex;/);
  assert.match(rule[1], /justify-content: center;/);
  assert.match(rule[1], /white-space: nowrap;/);
  assert.match(css, /\.queue-promo\.is-hidden,\s*\.queue-recent\.is-hidden \{ display: none; \}/);
  assert.match(css, /\.queue-icon \{[\s\S]*?height: 1\.2em;/);
  assert.match(css, /\.queue-move \{[\s\S]*?justify-content: center;/);
});

// ------------------------------------------------------------- stage wiring

test('the stage swaps the promotion for the live row when someone joins', () => {
  const js = read('public/js/stage.js');
  assert.match(js, /window\.QueuePromo/);
  assert.match(js, /const empty = window\.QueuePromo\r?\n?\s*\? !window\.QueuePromo\.hasWaiting\(queue\)/);
  assert.match(js, /queuePromoEl\.classList\.toggle\('is-hidden', !empty\)/);
  assert.match(js, /queueRecentEl\.classList\.toggle\('is-hidden', empty \|\| !recentText\)/);
  assert.match(js, /function fitQueuePromo\(\)/);
  assert.match(js, /if \(empty\) fitQueuePromo\(\);/);
  // The promotion is markup, so the row's text must no longer be overwritten.
  assert.doesNotMatch(js, /queueMoveEl\.textContent/);
  assert.match(js, /queueMoveEl\.clientWidth/);
});

test('the promo helper loads before the stage controller', () => {
  const html = read('public/index.html');
  const helper = html.indexOf('/js/queue-promo.js');
  const stage = html.indexOf('/js/stage.js');
  assert.ok(helper > 0 && stage > helper);
});

test('movement text never overwrites the promotion markup', () => {
  const js = read('public/js/stage.js');
  assert.match(js, /queueRecentEl\.classList\.toggle\('is-hidden', empty \|\| !recentText\)/);
  assert.match(js, /if \(queueRecentEl\) queueRecentEl\.textContent = movement\.message \|\| '';/);
  assert.doesNotMatch(js, /queueMoveEl\.textContent/);
});
