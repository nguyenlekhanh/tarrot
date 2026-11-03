'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TOPIC_DEFAULTS,
  normalizeTopics,
  normalizeTopicSettings,
  detectTopic,
  rotateTopics,
  extractQuestion
} = require('../tarot-topics');

test('the twelve designed topics are present, unique and enabled', () => {
  const topics = normalizeTopics(TOPIC_DEFAULTS);
  assert.equal(topics.length, 12);
  assert.equal(new Set(topics.map((topic) => topic.label)).size, 12);
  assert.equal(new Set(topics.map((topic) => topic.id)).size, 12);
  assert.ok(topics.every((topic) => topic.enabled !== false));
  assert.ok(topics.some((topic) => topic.label === 'Future Partner'));
});

test('duplicate topics are removed while order is preserved', () => {
  const topics = normalizeTopics([
    { label: 'Love Reading', order: 0 },
    { label: 'Love Reading', order: 1 },
    { label: 'Career Reading', order: 2 }
  ]);
  assert.deepEqual(topics.map((topic) => topic.label), ['Love Reading', 'Career Reading']);
});

test('a love comment selects the Love Reading topic', () => {
  const topic = detectTopic('tarot reading about my love life please', normalizeTopics(TOPIC_DEFAULTS));
  assert.equal(topic.label, 'Love Reading');
  assert.equal(topic.theme, 'love');
  assert.equal(topic.matched, true);
});

test('career, study, family and crush comments match their own topics', () => {
  const topics = normalizeTopics(TOPIC_DEFAULTS);
  assert.equal(detectTopic('will I get the job promotion?', topics).label, 'Career Reading');
  assert.equal(detectTopic('my exam is next week', topics).label, 'Study Reading');
  assert.equal(detectTopic('things are tense with my mother', topics).label, 'Family Reading');
  assert.equal(detectTopic('does my crush like me back', topics).label, 'Crush Reading');
});

test('a bare question falls back to My Question and keeps the words', () => {
  const topics = normalizeTopics(TOPIC_DEFAULTS);
  const topic = detectTopic('will he text me back?', topics);
  assert.equal(topic.label, 'My Question');
  assert.equal(topic.matched, false);
  assert.equal(extractQuestion('tarot reading: will he text me back?'), 'will he text me back?');
});

test('a non-question without keywords is not a reading request', () => {
  assert.equal(detectTopic('hello everyone, good stream', normalizeTopics(TOPIC_DEFAULTS)), null);
  assert.equal(detectTopic('', normalizeTopics(TOPIC_DEFAULTS)), null);
});

test('disabled topics are neither detected nor rotated', () => {
  const topics = normalizeTopics(TOPIC_DEFAULTS).map((topic) =>
    topic.id === 'love_reading' ? { ...topic, enabled: false } : topic
  );
  const detected = detectTopic('tarot reading about love', topics);
  assert.ok(!detected || detected.label !== 'Love Reading');
  const rotation = rotateTopics(topics, { rotationSeconds: 6 }, 0);
  const labels = rotation.columns.flat().map((item) => item.label);
  assert.ok(!labels.includes('Love Reading'));
});

test('rotation advances one step per interval and wraps around', () => {
  const topics = normalizeTopics(TOPIC_DEFAULTS).slice(0, 6);
  const first = rotateTopics(topics, { rotationSeconds: 6, rows: 3 }, 0);
  assert.equal(first.step, 0);
  assert.deepEqual(first.columns.map((column) => column.map((item) => item.label)), [
    ['Family Reading', 'Personality Reading', 'Name Reading'],
    ["This Week's Fortune", "Today's Fortune", 'My Question']
  ]);

  const second = rotateTopics(topics, { rotationSeconds: 6, rows: 3 }, 12_000);
  assert.equal(second.step, 2);
  assert.equal(second.columns[0][0].label, 'Name Reading');

  const wrapped = rotateTopics(topics, { rotationSeconds: 6, rows: 3 }, 36_000);
  assert.equal(wrapped.step, 0);
});

test('two columns never repeat a topic inside one page', () => {
  const topics = normalizeTopics(TOPIC_DEFAULTS);
  const rotation = rotateTopics(topics, { rotationSeconds: 5, rows: 3 }, 5000);
  const labels = rotation.columns.flat().map((item) => item.label);
  assert.equal(labels.length, 6);
  assert.equal(new Set(labels).size, 6);
});

test('topic settings clamp to supported values', () => {
  assert.equal(normalizeTopicSettings({ rotationSeconds: 7 }).rotationSeconds, 6);
  assert.equal(normalizeTopicSettings({ rotationSeconds: 15 }).rotationSeconds, 15);
  assert.equal(normalizeTopicSettings({ enabled: false }).enabled, false);
  assert.equal(normalizeTopicSettings({ rows: 99 }).rows, 4);
});

test('keyword lists accept strings and are normalised to lowercase', () => {
  const topics = normalizeTopics([{ label: 'Pet Reading', keywords: 'dog, Cat ,,' }]);
  assert.deepEqual(topics[0].keywords, ['dog', 'cat']);
  assert.equal(detectTopic('what does my dog think?', topics).label, 'Pet Reading');
});
