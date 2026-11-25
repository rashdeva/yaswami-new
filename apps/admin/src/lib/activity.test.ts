import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ago, startParts } from './activity.ts';

test('ссылка входа: событие, кто позвал, метка', () => {
  assert.deepEqual(startParts('e_ab12-r123456-spost1'), { event: { entity: 'event', id: 'e_ab12' }, ref: 123456, tag: 'post1', other: null });
  assert.deepEqual(startParts('c_chan-5-0'), { event: { entity: 'collected_event', id: 'chan-5-0' }, ref: null, tag: null, other: null });
  assert.deepEqual(startParts('promo'), { event: null, ref: null, tag: null, other: 'promo' });
  assert.deepEqual(startParts(null), { event: null, ref: null, tag: null, other: null });
});

test('когда был', () => {
  const now = Date.parse('2026-11-26T12:00:00Z');
  const before = (ms: number) => new Date(now - ms).toISOString();
  assert.equal(ago(before(20_000), now), 'только что');
  assert.equal(ago(before(12 * 60_000), now), '12 мин назад');
  assert.equal(ago(before(3 * 3_600_000), now), '3 ч назад');
  assert.equal(ago(before(30 * 3_600_000), now), 'вчера');
  assert.equal(ago(before(5 * 86_400_000), now), '5 дн. назад');
  assert.match(ago('2026-10-01T10:00:00Z', now), /1 окт/);
});
