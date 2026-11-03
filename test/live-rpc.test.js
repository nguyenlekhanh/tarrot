'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('every JSON-RPC request is answered even when a handler hangs', () => {
  const server = read('server.js');
  assert.match(server, /const RPC_TIMEOUT_MS = \d+;/);
  assert.match(server, /let replied = false;/);
  assert.match(server, /timed out after \$\{Math\.round\(RPC_TIMEOUT_MS \/ 1000\)\}s/);
  // The catch branch logs the method so a failing call is diagnosable.
  assert.match(server, /console\.warn\(`\[RPC\] \$\{method\} failed:/);
});

test('admin buttons cannot spin forever: every fetch has a timeout', () => {
  const admin = read('public/admin.html');
  const timeouts = admin.match(/new AbortController\(\)/g) || [];
  assert.ok(timeouts.length >= 4, `expected the RPC helpers to abort, found ${timeouts.length}`);
  assert.match(admin, /timed out after 30s/);
  // Test One Card / Three Cards must narrate, not draw silently.
  assert.match(admin, /rpc\('tarot\.testOne', \{ theme: 'love', announce: true \}\)/);
  assert.match(admin, /rpc\('tarot\.testThree', \{ question: 'What do the cards see\?', announce: true \}\)/);
});

test('the admin gift test uses a configured coin tier', () => {
  const admin = read('public/admin.html');
  const server = read('server.js');
  const menu = server.slice(server.indexOf('const COIN_MENU ='), server.indexOf('// Exact match only'));
  const tiers = [...menu.matchAll(/coins: (\d+)/g)].map((match) => Number(match[1]));
  const adminGift = admin.match(/sendRpc\('shop\.gift', \{ coins: (\d+),/);
  assert.ok(adminGift, 'admin gift button must send a coin value');
  assert.ok(tiers.includes(Number(adminGift[1])), `gift coins ${adminGift[1]} is not in the menu ${tiers.join(',')}`);
});

test('narration never blocks the reading RPC', () => {
  const server = read('server.js');
  assert.doesNotMatch(server, /await announceTarotReading\(reading, result/);
  assert.match(server, /announceTarotReading\(reading, result, ceremonyClips\)\.catch/);
});

test('the stage handles each temple.event once', () => {
  const stage = read('public/js/stage.js');
  const occurrences = stage.split("msg.method === 'temple.event'").length - 1;
  assert.strictEqual(occurrences, 1, `temple.event branch is duplicated ${occurrences} times`);
  assert.match(stage, /handleServerEvent\(msg\.params && msg\.params\.event\);/);
});

test('the stage plays clips through one serial queue', () => {
  const stage = read('public/js/stage.js');
  assert.match(stage, /new window\.TtsQueue\(/);
  assert.match(stage, /speech\.push\(\{ url, volume \}\)/);
  assert.match(stage, /notifyReading\(false\)/);
});

test('the conversation engine keeps a single scheduler and one clip at a time', () => {
  const conversation = read('public/js/conversation.js');
  assert.match(conversation, /setInterval\(\(\) => this\.tick\(\), 500\)/);
  assert.match(conversation, /if \(this\.speaking\) return false;/);
  assert.match(conversation, /if \(this\.speechBusy\(\)\) return false;/);
  assert.match(conversation, /this\.nextAt = Date\.now\(\) \+ this\.intervalMs\(\);/);
});
