import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLocation, approximateLocation } from '../public/location.js';
test('network location retains only province and country, rejecting failures', () => {
  assert.deepEqual(normalizeLocation({ success: true, region: ' Istanbul ', country_code: 'TR', ip: '192.0.2.1', latitude: 40 }), { region: 'Istanbul', country: 'TR' });
  for (const data of [null, {}, { success: false }, { success: true, region: 'Test', country_code: 'wrong' }]) assert.equal(normalizeLocation(data), null);
});
test('unavailable location service never blocks participation', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Offline'); };
  try { assert.equal(await approximateLocation(), null); } finally { globalThis.fetch = original; }
});
