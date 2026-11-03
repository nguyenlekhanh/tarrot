'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TarotQueue, formatMovement } = require('../tarot-queue');

function fakeClock(start = 1_000_000) {
  let value = start;
  return {
    now: () => value,
    advance(ms) {
      value += ms;
    }
  };
}

function makeQueue(options = {}) {
  const clock = fakeClock();
  const queue = new TarotQueue({ now: clock.now, capacity: 100, waitIntervalSeconds: 90, waitAmount: 1, ...options });
  return { queue, clock };
}

test('queue keeps first-come-first-served order with equal scores', () => {
  const { queue } = makeQueue();
  queue.add({ user: 'Sophia', uniqueId: 'sophia' });
  queue.add({ user: 'Emily', uniqueId: 'emily' });
  queue.add({ user: 'Olivia', uniqueId: 'olivia' });
  assert.deepEqual(queue.snapshot().entries.map((entry) => entry.user), ['Sophia', 'Emily', 'Olivia']);
  assert.equal(queue.positionOf('Olivia'), 3);
});

test('queue rejects additions past capacity and reports the limit', () => {
  const { queue } = makeQueue({ capacity: 2 });
  assert.equal(queue.add({ user: 'A' }).ok, true);
  assert.equal(queue.add({ user: 'B' }).ok, true);
  const full = queue.add({ user: 'C' });
  assert.equal(full.ok, false);
  assert.equal(full.reason, 'queue_full');
  assert.equal(queue.snapshot().count, 2);
  assert.equal(queue.snapshot().dropped, 1);
});

test('lowering capacity drops the lowest-priority viewers', () => {
  const { queue } = makeQueue();
  queue.add({ user: 'A' });
  queue.add({ user: 'B' });
  queue.add({ user: 'C' });
  const result = queue.setCapacity(2);
  assert.equal(result.capacity, 2);
  assert.deepEqual(result.dropped.map((item) => item.user), ['C']);
  assert.deepEqual(queue.snapshot().entries.map((entry) => entry.user), ['A', 'B']);
});

test('the same viewer cannot occupy the queue twice', () => {
  const { queue } = makeQueue();
  queue.add({ user: 'Emily', uniqueId: 'emily' });
  const second = queue.add({ user: 'Emily', uniqueId: 'emily' });
  assert.equal(second.duplicate, true);
  assert.equal(queue.snapshot().count, 1);
});

test('an empty or blank viewer is rejected', () => {
  const { queue } = makeQueue();
  assert.equal(queue.add({ user: '   ' }).ok, false);
  assert.equal(queue.add({}).reason, 'missing_viewer');
});

test('removing a viewer updates positions', () => {
  const { queue } = makeQueue();
  queue.add({ user: 'A' });
  queue.add({ user: 'B' });
  queue.add({ user: 'C' });
  const removed = queue.remove('B');
  assert.equal(removed.ok, true);
  assert.deepEqual(queue.snapshot().entries.map((entry) => entry.user), ['A', 'C']);
  assert.equal(queue.positionOf('C'), 2);
});

test('a gift promotion moves a viewer up and produces the exact message', () => {
  const { queue } = makeQueue({ capacity: 100 });
  queue.add({ user: 'Sophia' });
  queue.add({ user: 'Emily' });
  queue.add({ user: 'Olivia' });
  const result = queue.promote('Olivia', 5, 'gift');
  assert.equal(result.moved, true);
  assert.equal(result.from, 3);
  assert.equal(result.to, 1);
  assert.equal(result.movement.message, '🎁 OLIVIA SENT A GIFT! MOVED UP: #3 → #1');
  assert.equal(result.movement.ticker, '🎁 OLIVIA SENT A GIFT! #3 → #1');
  assert.equal(queue.snapshot().entries[0].user, 'Olivia');
});

test('promoting the head of the queue records no movement', () => {
  const { queue } = makeQueue();
  queue.add({ user: 'Sophia' });
  queue.add({ user: 'Emily' });
  const result = queue.promote('Sophia', 3, 'gift');
  assert.equal(result.moved, false);
  assert.equal(result.movement, null);
  assert.equal(queue.snapshot().recent.length, 0);
});

test('a gift combo group promotes only once', () => {
  const { queue } = makeQueue();
  queue.add({ user: 'Sophia', uniqueId: 'sophia' });
  queue.add({ user: 'Emily', uniqueId: 'emily' });
  const mapping = [{ id: 'rose', name: 'Rose', promote: 2, aliases: ['rose'] }];
  const first = queue.promoteGift({ key: 'u:emily', groupId: 'g-1', giftName: 'rose', coins: 1, mapping });
  assert.equal(first.moved, true);
  const second = queue.promoteGift({ key: 'u:emily', groupId: 'g-1', giftName: 'rose', coins: 1, mapping });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'duplicate_gift_group');
  assert.equal(queue.snapshot().recent.length, 1);
});

test('gift mapping decides the promotion amount, coins only fill the gaps', () => {
  const { queue } = makeQueue();
  queue.add({ user: 'Emily', uniqueId: 'emily' });
  queue.add({ user: 'A' });
  queue.add({ user: 'B' });
  queue.add({ user: 'C' });
  const mapped = queue.promoteGift({
    key: 'u:emily',
    groupId: 'g-rose',
    giftName: 'Rose',
    coins: 1,
    mapping: [{ id: 'rose', name: 'Rose', promote: 3, aliases: ['rose'] }]
  });
  assert.equal(mapped.to, 1);

  queue.add({ user: 'D', uniqueId: 'd' });
  queue.add({ user: 'E', uniqueId: 'e' });
  const coins = queue.promoteGift({ key: 'u:d', groupId: 'g-coins', giftName: 'Unknown', coins: 10, coinsPerStep: 5, mapping: [] });
  assert.equal(coins.moved, true);
  assert.equal(coins.to, 2);
});

test('like promotion moves a queued viewer up', () => {
  const { queue } = makeQueue();
  queue.add({ user: 'A' });
  queue.add({ user: 'B' });
  queue.add({ user: 'Olivia' });
  const result = queue.promoteLike({ user: 'Olivia', amount: 2 });
  assert.equal(result.moved, true);
  assert.equal(result.movement.kind, 'like');
  assert.match(result.movement.message, /SENT LOTS OF LOVE/);
  assert.equal(queue.positionOf('Olivia'), 1);
});

test('waiting time promotes a viewer without any gift', () => {
  const { queue, clock } = makeQueue({ waitIntervalSeconds: 10, waitAmount: 1 });
  queue.add({ user: 'Sophia', uniqueId: 'sophia' });
  clock.advance(1000);
  queue.add({ user: 'Emily', uniqueId: 'emily' });
  queue.promote('u:emily', 1, 'gift');
  assert.equal(queue.positionOf('sophia'), 2);

  clock.advance(39_000);
  const movements = queue.accrueWait();
  assert.equal(queue.positionOf('sophia'), 1);
  assert.ok(movements.length >= 1);
  assert.equal(movements[0].kind, 'wait');
  assert.match(movements[0].message, /SOPHIA MOVED UP: #2 → #1/);
});

test('waiting credits never shrink when the clock moves backwards', () => {
  const { queue, clock } = makeQueue({ waitIntervalSeconds: 10 });
  queue.add({ user: 'A' });
  clock.advance(35_000);
  queue.accrueWait();
  const steps = queue.snapshot().entries[0].score;
  clock.advance(-30_000);
  queue.accrueWait();
  assert.equal(queue.snapshot().entries[0].score, steps);
});

test('the queue survives a restart through its persisted snapshot', () => {
  const { queue, clock } = makeQueue();
  queue.add({ user: 'Sophia', uniqueId: 'sophia', topicLabel: 'Love Reading' });
  queue.add({ user: 'Emily', uniqueId: 'emily' });
  queue.promote('u:emily', 4, 'gift');
  clock.advance(5000);
  const saved = queue.toJSON();

  const restored = new TarotQueue({ now: clock.now, capacity: saved.capacity });
  restored.hydrate(saved.entries, saved.seq);
  assert.deepEqual(restored.snapshot().entries.map((entry) => entry.user), ['Emily', 'Sophia']);
  assert.equal(restored.snapshot().entries[1].topicLabel, 'Love Reading');
  // New arrivals after a restart keep their place after the persisted ones.
  restored.add({ user: 'Olivia', uniqueId: 'olivia' });
  assert.equal(restored.positionOf('olivia'), 3);
});

test('snapshot exposes the three stage lines and never shows undefined', () => {
  const { queue } = makeQueue();
  const empty = queue.snapshot();
  assert.equal(empty.lines.current, 'THE READING TABLE IS WAITING');
  assert.equal(empty.lines.next, 'NEXT: THE LINE IS OPEN');
  assert.equal(empty.lines.count, '0 / 100 WAITING');
  assert.ok(!JSON.stringify(empty.lines).includes('undefined'));

  queue.add({ user: 'Sophia' });
  queue.add({ user: 'Emily' });
  queue.add({ user: 'Olivia' });
  queue.startNext();
  const busy = queue.snapshot();
  assert.equal(busy.lines.current, 'NOW READING: SOPHIA');
  assert.equal(busy.lines.next, 'NEXT: EMILY → OLIVIA');
  assert.equal(busy.count, 2);
});

test('starting the next reading removes that viewer from the line', () => {
  const { queue } = makeQueue();
  queue.add({ user: 'Sophia' });
  queue.add({ user: 'Emily' });
  const current = queue.startNext();
  assert.equal(current.user, 'Sophia');
  assert.equal(queue.snapshot().count, 1);
  assert.equal(queue.complete(current.key), true);
  assert.equal(queue.snapshot().current, null);
  assert.equal(queue.snapshot().served, 1);
});

test('movement text is exact for every promotion kind', () => {
  assert.equal(formatMovement('gift', 'Emily', 77, 71), '🎁 EMILY SENT A GIFT! MOVED UP: #77 → #71');
  assert.equal(formatMovement('like', 'Olivia', 77, 71), '💗 OLIVIA SENT LOTS OF LOVE! MOVED UP: #77 → #71');
  assert.equal(formatMovement('wait', 'Sophia', 75, 74), '🌹 SOPHIA MOVED UP: #75 → #74');
  assert.equal(formatMovement('gift', 'Sophia', 75, 74, { ticker: true }), '🎁 SOPHIA SENT A GIFT! #75 → #74');
  assert.equal(formatMovement('like', 'Emily', 77, 71, { ticker: true }), '💗 EMILY IS SENDING LOTS OF LOVE! #77 → #71');
});
