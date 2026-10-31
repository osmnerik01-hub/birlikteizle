import test from 'node:test';
import assert from 'node:assert/strict';
import { constrainChatSize } from '../public/chat-resize.js';
test('chat resize preserves space for video and keeps composer inside viewport', () => {
  assert.deepEqual(constrainChatSize({width:2000,height:2000}, {gridWidth:900,viewportHeight:720,top:233}), {width:520,height:467});
  assert.deepEqual(constrainChatSize({width:0,height:1}, {gridWidth:600,viewportHeight:720,top:233}), {width:270,height:300});
});
test('mobile uses available width and clamps height after viewport changes', () => {
  assert.deepEqual(constrainChatSize({width:500,height:900}, {gridWidth:350,viewportHeight:640,mobile:true}), {width:350,height:608});
  assert.equal(constrainChatSize({height:900}, {gridWidth:900,viewportHeight:400,top:20}).height,360);
});
