import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionLabel, entityLink, showValue, snapshotDiff } from './journal.ts';

test('подпись действия: известное, от имени пользователя, неизвестное админское', () => {
  assert.equal(actionLabel('admin_events_update'), 'Изменено событие');
  assert.equal(actionLabel('admin_actions_undo'), 'Отмена действия');
  assert.equal(actionLabel('events_update'), 'От имени пользователя: events_update');
  assert.equal(actionLabel('admin_new_thing'), 'admin_new_thing');
});

test('куда ведёт сущность', () => {
  assert.deepEqual(entityLink('event', 'ab'), { to: '/events/$id', params: { id: 'ab' } });
  assert.deepEqual(entityLink('conversation', 'c1'), { to: '/', search: { c: 'c1' } });
  assert.equal(entityLink('message', 'm1'), null);
});

test('разница снимков: изменённые поля и дети', () => {
  const before = { row: { id: 'e', name: 'Старое', max_capacity: 10, guide: { what: 'a' } }, guests: [{ user_id: 1 }], ticket_types: [{ id: 't' }] };
  const after = { row: { id: 'e', name: 'Новое', max_capacity: 10, guide: { what: 'b' } }, guests: [{ user_id: 1 }, { user_id: 2 }], ticket_types: [{ id: 't' }] };
  const d = snapshotDiff(before, after);
  assert.equal(d.kind, 'changed');
  assert.deepEqual(d.fields, [{ key: 'name', before: 'Старое', after: 'Новое' }, { key: 'guide', before: { what: 'a' }, after: { what: 'b' } }]);
  assert.deepEqual(d.children, [{ name: 'guests', before: 1, after: 2, changed: true }, { name: 'ticket_types', before: 1, after: 1, changed: false }]);
});

test('разница снимков: создано и удалено', () => {
  const snap = { row: { id: 'e', name: 'Х' }, guests: [] };
  const created = snapshotDiff(null, snap);
  assert.equal(created.kind, 'created');
  assert.deepEqual(created.fields, [{ key: 'id', before: null, after: 'e' }, { key: 'name', before: null, after: 'Х' }]);
  assert.deepEqual(created.children, [{ name: 'guests', before: null, after: 0, changed: true }]);
  assert.equal(snapshotDiff(snap, null).kind, 'deleted');
});

test('значение поля для таблицы', () => {
  assert.equal(showValue(null), '—');
  assert.equal(showValue(true), 'да');
  assert.equal(showValue({ a: 1 }), '{"a":1}');
  assert.equal(showValue('x'.repeat(400)).length, 301);
});
