import test from 'node:test';
import assert from 'node:assert/strict';
import { WatchPlayer } from '../src/player.js';

test('echoed room samples never rewind the leader; moderator updates follow the new controller', async () => {
  const commands = [], syncs = [];
  const player = { kind: 'page', source: { url: 'https://example.com/watch' }, remote: { ready: true },
    isLeader: () => true, canControl: () => true, currentTime: 42, playing: true,
    extension: { sync: async (...args) => syncs.push(args), command: async command => commands.push(command) },
    panel: { querySelector: () => ({}) }
  };
  await WatchPlayer.prototype.apply.call(player, { time: 42, playing: false });
  assert.deepEqual(commands, []);
  assert.equal(syncs[0][2], true);
  player.isLeader = () => false;
  await WatchPlayer.prototype.apply.call(player, { time: 42, playing: false });
  assert.equal(commands.length, 0);
  assert.equal(syncs[1][2], false, "moderator intent is sent to the follower synchronizer");
});


test('seeking and buffering do not publish pause/play loops to the room', () => {
  const published = [];
  const player = { kind: 'page', source: { url: 'https://example.com/watch' }, remote: { playing: true },
    get playing() { return this.remote.playing; }, get currentTime() { return this.remote.time; },
    panel: { querySelector: () => ({}) }, canControl: () => true, isLeader: () => true,
    updateTracks() {}, update() {}, wake() {}, onPlayback: state => published.push(state) };
  for (const state of [
    { time: 80, playing: true, seeking: true },
    { time: 80, playing: true, buffering: true },
    { time: 80, playing: true, userAction: true }
  ]) WatchPlayer.prototype.acceptRemote.call(player, { pageUrl: player.source.url, ...state });
  assert.deepEqual(published, [{ time: 80, playing: true }]);
});
