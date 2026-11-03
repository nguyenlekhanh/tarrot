'use strict';

/**
 * The Admin test tools must ride the real live pipeline: the viewer-join
 * handler, the chat comment detection, the tarot queue and the shared TTS
 * broadcast. These tests fail if the panel grows a second engine, a second
 * player or a hardcoded topic list.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { detectTopic, normalizeTopics, TOPIC_DEFAULTS } = require('../tarot-topics');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const admin = read('public/admin.html');
const server = read('server.js');

function panel() {
  const start = admin.indexOf('id="testUserPanel"');
  assert.ok(start > 0, 'the Admin test-user panel is missing');
  return admin.slice(start, admin.indexOf('</html>', start));
}

test('Admin ships the join button and the comment section', () => {
  const html = panel();
  assert.match(html, /id="tuJoin"[^>]*>TEST USER JOIN</);
  assert.match(html, /SEND COMMENT/);
  for (const id of [
    'tuUser', 'tuComment', 'tuSend', 'tuJoinStatus', 'tuSendStatus',
    'tuTopics', 'tuState', 'tuOutUser', 'tuOutComment', 'tuOutTopic',
    'tuOutPosition', 'tuOutReading', 'tuOutCards', 'tuOutNarration'
  ]) {
    assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
  }
  assert.match(html, /CHOOSE YOUR DESTINY/);
  assert.match(html, /COMMENT \+ YOUR QUESTION/);
  assert.match(html, /value="TEST_VIEWER_01"/);
});

test('the test result uses the five required statuses', () => {
  const html = panel();
  for (const status of ['WAITING', 'QUEUED', 'READING', 'COMPLETED', 'ERROR']) {
    assert.ok(html.includes(`'${status}'`), `status ${status} is never set`);
  }
});

test('Admin rides the real join, comment, reading and speech events', () => {
  const html = panel();
  assert.match(html, /viewers\.testJoin/);
  assert.match(html, /tarot\.simulateComment/);
  assert.match(html, /msg\.method === 'tarot\.reading'/);
  assert.match(html, /msg\.method === 'tts\.play'/);
  assert.match(html, /params\.readingId/);
  // COMPLETED must wait for the reading event and the narration, not the RPC.
  assert.doesNotMatch(html, /setState\('COMPLETED'\);\s*\n\s*\$\('tuSendStatus'\)/);
});

test('the topic chips are loaded from the server, never a second list', () => {
  const html = panel();
  assert.match(html, /renderTopicChips\(tarot\.topics\)/);
  assert.match(html, /msg\.params\.topics\)\) renderTopicChips/);
  // The chips host starts empty; every chip is rendered from a server snapshot.
  const host = html.slice(html.indexOf('id="tuTopics"'), html.indexOf('</div>', html.indexOf('id="tuTopics"')));
  assert.match(host, /Loading topics/);
  assert.equal(/data-topic=/.test(host), false, 'topics are hardcoded in the markup');
  assert.equal(/Love Reading|Crush Reading|Future Partner|Wealth Reading/.test(host), false);
});

test('a reading that arrives before the RPC reply is never stepped back', () => {
  const html = panel();
  assert.match(html, /if \(!view\.readingId\) setState\('QUEUED'\)/);
  assert.match(html, /view\.status !== 'READING' && view\.status !== 'QUEUED'/);
  // The test viewer is keyed by username so joins dedupe and cooldowns apply.
  assert.match(html, /function uniqueIdFor\(/);
  assert.match(html, /uniqueIdFor\(user\)/);
});

test('the panel does not build another engine, queue or player', () => {
  const html = panel();
  assert.doesNotMatch(html, /new MysticConversationEngine/);
  assert.doesNotMatch(html, /new TarotQueue/);
  assert.doesNotMatch(html, /new TtsQueue/);
  assert.doesNotMatch(html, /new Audio\(/);
});

test('the test join uses the real viewer-join handler and reuses one viewer', () => {
  assert.match(server, /case 'viewers\.testJoin':/);
  const start = server.indexOf("case 'viewers.testJoin':");
  const block = server.slice(start, server.indexOf("case 'tarot.getState':", start));
  assert.match(block, /Actions\.viewerJoin\(/);
  assert.match(block, /findViewerRecord\(/);
  assert.match(block, /duplicate: true/);
});

test('the test comment echoes the matched topic and respects cooldowns', () => {
  const start = server.indexOf("case 'tarot.simulateComment':");
  const block = server.slice(start, server.indexOf("case 'tarot.simulateGift':", start));
  assert.match(block, /maybeHandleTarotComment\(/);
  assert.match(block, /detectLiveReadingRequest\(/);
  assert.match(block, /topic: detected/);
  assert.doesNotMatch(block, /bypassCooldowns/);
  // Cooldown rejections report the remaining wait instead of dropping silently.
  assert.match(server, /reason: 'global_cooldown',[\s\S]{0,200}retryAfterSeconds/);
  assert.match(server, /reason: 'viewer_cooldown',[\s\S]{0,200}retryAfterSeconds/);
});

test('every acceptance topic resolves to its own label', () => {
  const topics = normalizeTopics(TOPIC_DEFAULTS);
  const cases = [
    ['Love Reading', 'Love Reading'],
    ['Crush Reading', 'Crush Reading'],
    ['Future Partner', 'Future Partner'],
    ['Career Reading', 'Career Reading'],
    ['Wealth Reading', 'Wealth Reading'],
    ['My Question', 'My Question'],
    ['Tarot love reading please', 'Love Reading'],
    ['what does my future hold?', 'My Question']
  ];
  for (const [comment, label] of cases) {
    const topic = detectTopic(comment, topics);
    assert.ok(topic, `${comment} matched no topic`);
    assert.equal(topic.label, label, `${comment} matched ${topic.label}`);
  }
});
