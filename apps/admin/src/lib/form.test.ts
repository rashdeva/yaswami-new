import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromLocal, issueFields, offsetOf, pickDirty, splitList, toLocal } from './form.ts';

test('время на стене: IANA-пояс туда и обратно', () => {
  assert.equal(toLocal('2026-11-20T15:00:00.000Z', 'Asia/Tbilisi'), '2026-11-20T19:00');
  assert.equal(fromLocal('2026-11-20T19:00', 'Asia/Tbilisi'), '2026-11-20T15:00:00.000Z');
});

test('время на стене: смещение сохраняется как есть', () => {
  assert.equal(toLocal('2026-11-20T19:00:00+07:00', '+07:00'), '2026-11-20T19:00');
  assert.equal(toLocal('2026-11-20T12:00:00Z', '-03:30'), '2026-11-20T08:30');
  assert.equal(fromLocal('2026-11-20T19:30', '+07:00'), '2026-11-20T19:30:00+07:00');
  assert.equal(offsetOf('2026-11-20T19:00:00+07:00'), '+07:00');
  assert.equal(offsetOf('2026-11-20T19:00:00.000Z'), 'Z');
});

test('шлём только изменённые поля, вложенные — целиком', () => {
  const values = { name: 'a', description: null, guide: { what: 'x', why: '' }, tags: ['a'], status: 'draft' };
  assert.deepEqual(pickDirty(values, { name: true, guide: { what: true }, tags: [true], status: false }), { name: 'a', guide: { what: 'x', why: '' }, tags: ['a'] });
  assert.deepEqual(pickDirty(values, {}), {});
});

test('ошибки полей от сервера', () => {
  assert.deepEqual(issueFields([{ path: ['name'], message: 'too long' }, { path: ['guide', 'what'] }, { path: [], message: 'all' }]), [['name', 'too long'], ['guide.what', 'Неверное значение']]);
  assert.deepEqual(issueFields(undefined), []);
});

test('списки по строкам и через запятую', () => {
  assert.deepEqual(splitList('раз\n\n два \n', 'line'), ['раз', 'два']);
  assert.deepEqual(splitList('йога, , бег', 'comma'), ['йога', 'бег']);
});
