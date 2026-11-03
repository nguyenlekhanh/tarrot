'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LiveEventEngine,
  LikeBatcher,
  GiftComboTracker
} = require('../live-event-engine');

function testEngine(handler, options = {}) {
  return new LiveEventEngine({
    handler,
    schedule: () => {},
    ...options
  });
}

test('1000 LIKE events become one batch and one reaction', () => {
  let now = 1000000;
  const batcher = new LikeBatcher(
    { enabled: true, windowSeconds: 5, minLikes: 10, cooldownSeconds: 20 },
    { clock: () => now }
  );
  for (let i = 0; i < 1000; i += 1) {
    batcher.ingest({ user: `Viewer ${i % 25}`, uniqueId: `viewer${i % 25}`, count: 1, at: now });
  }
  assert.equal(batcher.totalLikes, 1000);
  const batch = batcher.flush({ now });
  assert.equal(batch.likes, 1000);
  assert.equal(batch.events, 1000);
  assert.equal(batch.viewers.length, 25);
  assert.equal(batch.reaction.threshold, 500);
  assert.equal(batcher.totalLikes, 0);
  assert.equal(batcher.totalEvents, 0);
  assert.equal(batcher.reactionsGenerated, 1);
  assert.equal(batcher.flush({ now }), null);
});

test('automatic like windows flush once and respect the cooldown', () => {
  let now = 2000000;
  const batcher = new LikeBatcher(
    { enabled: true, windowSeconds: 5, minLikes: 10, cooldownSeconds: 20 },
    { clock: () => now }
  );
  batcher.ingest({ user: 'A', uniqueId: 'a', count: 10, at: now });
  assert.equal(batcher.tick(now + 1000), null);
  const first = batcher.tick(now + 5001);
  assert.equal(first.likes, 10);
  assert.ok(first.reaction);
  now += 6000;
  batcher.ingest({ user: 'B', uniqueId: 'b', count: 100, at: now });
  const second = batcher.tick(now + 5001);
  assert.equal(second.likes, 100);
  assert.equal(second.reaction, null, 'cooldown suppresses speech but not the batch');
  assert.equal(batcher.suppressedReactions, 1);
});

test('500 MEMBER events for duplicate usernames create one accepted event', async () => {
  const processed = [];
  const engine = testEngine(async (entry) => processed.push(entry.payload.uniqueId));
  for (let i = 0; i < 500; i += 1) {
    engine.push('MEMBER', { user: 'Alice', uniqueId: 'alice' }, { dedupeKey: 'member:u:alice' });
  }
  await engine.drainAll();
  assert.deepEqual(processed, ['alice']);
  const stats = engine.getStats();
  assert.equal(stats.perType.MEMBER.received, 500);
  assert.equal(stats.perType.MEMBER.processed, 1);
  assert.equal(stats.perType.MEMBER.duplicates, 499);
  assert.equal(engine.pending, 0);
});

test('mixed bursts preserve all event types and queue only the accepted events', async () => {
  const counts = {};
  const engine = testEngine(async (entry) => {
    counts[entry.type] = (counts[entry.type] || 0) + 1;
  });
  for (let i = 0; i < 100; i += 1) engine.push('FOLLOW', { uniqueId: `f${i}` });
  for (let i = 0; i < 100; i += 1) engine.push('SHARE', { uniqueId: `s${i}` });
  for (let i = 0; i < 100; i += 1) engine.push('CHAT', { uniqueId: `c${i}` });
  for (let i = 0; i < 50; i += 1) engine.push('GIFT', { uniqueId: `g${i}` });
  await engine.drainAll();
  assert.equal(counts.FOLLOW, 100);
  assert.equal(counts.SHARE, 100);
  assert.equal(counts.CHAT, 100);
  assert.equal(counts.GIFT, 50);
  assert.equal(engine.getStats().dropped, 0);
});

test('mixed six-type burst keeps like batching separate from the event queue', async () => {
  const counts = {};
  const engine = testEngine(async (entry) => {
    counts[entry.type] = (counts[entry.type] || 0) + 1;
  });
  const batcher = new LikeBatcher({ enabled: true, windowSeconds: 5, minLikes: 10 });
  for (let i = 0; i < 100; i += 1) engine.push('MEMBER', { uniqueId: `m${i}` });
  for (let i = 0; i < 100; i += 1) engine.push('FOLLOW', { uniqueId: `f${i}` });
  for (let i = 0; i < 100; i += 1) engine.push('SHARE', { uniqueId: `s${i}` });
  for (let i = 0; i < 100; i += 1) engine.push('CHAT', { uniqueId: `c${i}` });
  for (let i = 0; i < 50; i += 1) engine.push('GIFT', { uniqueId: `g${i}` });
  for (let i = 0; i < 500; i += 1) batcher.ingest({ user: `L${i % 20}`, uniqueId: `l${i % 20}`, count: 2 });
  await engine.drainAll();
  const batch = batcher.flush();
  assert.equal(counts.MEMBER, 100);
  assert.equal(counts.FOLLOW, 100);
  assert.equal(counts.SHARE, 100);
  assert.equal(counts.CHAT, 100);
  assert.equal(counts.GIFT, 50);
  assert.equal(batch.likes, 1000);
  assert.equal(batch.viewers.length, 20);
  assert.equal(engine.pending, 0);
});

test('queue limits bound memory under a CHAT flood', async () => {
  const engine = testEngine(async () => {}, {
    limits: { CHAT: 10, GIFT: 10, FOLLOW: 10, SHARE: 10, MEMBER: 10, LIKE: 10 },
    maxPending: 30
  });
  for (let i = 0; i < 5000; i += 1) engine.push('CHAT', { i });
  assert.ok(engine.pending <= 30);
  await engine.drainAll();
  assert.equal(engine.pending, 0);
  assert.ok(engine.getStats().dropped > 0);
});

test('gift combo deltas total 50 and duplicate repeat is not re-ordered', () => {
  const tracker = new GiftComboTracker();
  let total = 0;
  for (let repeat = 1; repeat <= 50; repeat += 1) {
    total += tracker.apply('group-1', repeat, repeat === 50).delta;
  }
  assert.equal(total, 50);
  assert.equal(tracker.apply('group-1', 50, true).delta, 0);
  assert.equal(tracker.apply('group-1', 51, false).delta, 1, 'a later combo update only adds the new repeat');
});

test('gift speech deferral suppresses a pending like reaction without losing likes', () => {
  let now = 3000000;
  const batcher = new LikeBatcher(
    { enabled: true, windowSeconds: 5, minLikes: 10, cooldownSeconds: 0 },
    { clock: () => now }
  );
  batcher.ingest({ user: 'A', uniqueId: 'a', count: 100, at: now });
  batcher.deferSpeech(5000);
  const batch = batcher.flush({ now: now + 100 });
  assert.equal(batch.likes, 100);
  assert.equal(batch.reaction, null);
  assert.equal(batcher.suppressedReactions, 1);
  now += 5001;
  batcher.ingest({ user: 'A', uniqueId: 'a', count: 100, at: now });
  assert.ok(batcher.flush({ now: now + 100 }).reaction);
});

test('multiple viewers keep per-viewer like totals and one global batch', () => {
  const batcher = new LikeBatcher({ enabled: true, windowSeconds: 5, minLikes: 10 });
  batcher.ingest({ user: 'A', uniqueId: 'a', count: 6 });
  batcher.ingest({ user: 'B', uniqueId: 'b', count: 4 });
  batcher.ingest({ user: 'A', uniqueId: 'a', count: 5 });
  const batch = batcher.flush();
  assert.equal(batch.likes, 15);
  assert.equal(batch.viewers.find((v) => v.uniqueId === 'a').count, 11);
  assert.equal(batch.viewers.find((v) => v.uniqueId === 'b').count, 4);
  assert.equal(batch.reaction.threshold, 10);
});

test('reliable event IDs are deduplicated', async () => {
  let processed = 0;
  const engine = testEngine(async () => { processed += 1; });
  engine.push('GIFT', { id: 1 }, { dedupeKey: 'gift:msg-1' });
  engine.push('GIFT', { id: 1 }, { dedupeKey: 'gift:msg-1' });
  await engine.drainAll();
  assert.equal(processed, 1);
  assert.equal(engine.getStats().duplicates, 1);
});

test('a handler failure does not stop later events from draining', async () => {
  let calls = 0;
  const engine = testEngine(async () => {
    calls += 1;
    if (calls === 1) throw new Error('simulated transport failure');
  });
  engine.push('FOLLOW', { uniqueId: 'a' });
  engine.push('FOLLOW', { uniqueId: 'b' });
  await engine.drainAll();
  assert.equal(calls, 2);
  assert.equal(engine.getStats().errors, 1);
  assert.equal(engine.pending, 0);
});