import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAdminAccess, authErrorMessage, withAuthTimeout } from '../public/admin-auth.js';

test('admin checks distinguish authorized, denied and unreachable database states', async () => {
  assert.equal(await checkAdminAccess(async () => ({ exists: () => true })), true);
  assert.equal(await checkAdminAccess(async () => { throw { code: 'PERMISSION_DENIED' }; }), false);
  assert.equal(await checkAdminAccess(async () => { throw { code: 'database/permission-denied' }; }), false);
  const network = Object.assign(new Error('offline'), { code: 'database/network-error' });
  await assert.rejects(checkAdminAccess(async () => { throw network; }), error => error === network);
});

test('a stalled permission read times out rather than leaving login spinning forever', async () => {
  let finish;
  const delayed = new Promise(resolve => finish = resolve);
  await assert.rejects(checkAdminAccess(() => delayed, 10), error => error.code === 'admin/timeout');
  finish({});
  assert.equal(await checkAdminAccess(async () => ({}), 20), true, 'a retry can succeed after the timeout');
});

test('authentication timeout preserves actual Firebase errors and user guidance', async () => {
  const blocked = Object.assign(new Error('blocked'), { code: 'auth/popup-blocked' });
  await assert.rejects(withAuthTimeout(Promise.reject(blocked), 20, 'timeout'), error => error === blocked);
  assert.match(authErrorMessage(blocked), /pencere/);
  assert.match(authErrorMessage({ code: 'auth/popup-closed-by-user' }), /tamamlanmadı/);
  assert.match(authErrorMessage({ code: 'auth/network-request-failed' }), /bağlantı/i);
});
