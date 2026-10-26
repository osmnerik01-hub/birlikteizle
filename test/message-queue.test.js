import test from 'node:test';
import assert from 'node:assert/strict';
import { createMessageQueue } from '../public/message-queue.js';

test('a rapid chat burst is paced, ordered and never sent concurrently', async () => {
  let clock = 0, active = 0; const sent = [], starts = [];
  const enqueue = createMessageQueue(async text => {
    assert.equal(active++, 0);
    sent.push(text); starts.push(clock);
    await Promise.resolve(); active--;
  }, { now: () => clock, wait: async ms => { clock += ms; } });
  await Promise.all(['one', 'two', 'three', 'four'].map(enqueue));
  assert.deepEqual(sent, ['one', 'two', 'three', 'four']);
  assert.deepEqual(starts, [0, 650, 1300, 1950]);
});

test('a failed message does not block later messages or get retried as a duplicate', async () => {
  const sent = [];
  const enqueue = createMessageQueue(async text => {
    sent.push(text); if (text === 'failed') throw new Error('offline');
  }, { interval: 0 });
  const results = await Promise.allSettled(['first', 'failed', 'last'].map(enqueue));
  assert.deepEqual(results.map(r => r.status), ['fulfilled', 'rejected', 'fulfilled']);
  assert.deepEqual(sent, ['first', 'failed', 'last']);
});

test('a full chat queue rejects excess before sending it and accepts messages after draining', async () => {
  let release; const gate = new Promise(resolve => release = resolve), sent = [];
  const enqueue = createMessageQueue(async text => { sent.push(text); await gate; }, { interval: 0, maxPending: 2 });
  const first = enqueue('first'), second = enqueue('second');
  await assert.rejects(enqueue('excess'), /korunuyor/);
  release(); await Promise.all([first, second]);
  await enqueue('next');
  assert.deepEqual(sent, ['first', 'second', 'next']);
});
