import test from 'node:test';
import assert from 'node:assert/strict';
import { createIncomingTracker, createChatSound } from '../public/chat-notifications.js';
const m = (id, memberId = 'other', at = 100) => ({ id, memberId, at });
test('notifications ignore initial history, own messages, repeats and older reconnect history', () => {
  const incoming = createIncomingTracker();
  assert.equal(incoming([m('history')], 'me'), false);
  assert.equal(incoming([m('history'), m('mine', 'me', 101)], 'me'), false);
  const batch = [m('history'), m('mine', 'me', 101), m('new', 'other', 102)];
  assert.equal(incoming(batch, 'me'), true);
  assert.equal(incoming(batch, 'me'), false);
  assert.equal(incoming([], 'me'), false);
  assert.equal(incoming([m('old', 'other', 99)], 'me'), false);
  assert.equal(incoming([m('latest', 'other', 103)], 'me'), true);
});
test('empty initial history permits the first live message', () => {
  const incoming = createIncomingTracker();
  assert.equal(incoming([], 'me'), false);
  assert.equal(incoming([m('first')], 'me'), true);
});
test('sound waits for interaction and limits bursts without breaking unsupported browsers', () => {
  let plays = 0, clock = 1000;
  const parameter = { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} };
  class Context {
    state = 'running'; currentTime = 0; destination = {};
    createGain() { return { gain: parameter, connect() {}, disconnect() {} }; }
    createOscillator() { return { frequency: parameter, connect() {}, disconnect() {}, start() { plays++; }, stop() {} }; }
  }
  const sound = createChatSound({ AudioContext: Context, now: () => clock });
  sound.play(); assert.equal(plays, 0);
  sound.unlock(); sound.play(); sound.play(); assert.equal(plays, 1);
  clock += 701; sound.play(); assert.equal(plays, 2);
  const unavailable = createChatSound({ AudioContext: null });
  assert.doesNotThrow(() => { unavailable.unlock(); unavailable.play(); });
});
