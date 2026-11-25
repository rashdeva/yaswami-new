import assert from 'node:assert/strict';
import { test } from 'node:test';
import { moveShelf, shelfHow } from './shelves.ts';

test('полка: как собирается — правило словами или число событий', () => {
  assert.equal(shelfHow({ rule: { period: 'week', topic: 'танцы', beginner_friendly: true }, event_ids: [] }), 'по правилу: на неделе · танцы · без опыта');
  assert.equal(shelfHow({ rule: {}, event_ids: [] }), 'по правилу: все предстоящие');
  assert.equal(shelfHow({ rule: null, event_ids: ['a', 'b', 'c'] }), 'вручную: 3 события');
  assert.equal(shelfHow({ rule: null, event_ids: ['a'] }), 'вручную: 1 событие');
});

test('полка: перестановка меняет только сдвинутые места и разводит одинаковые', () => {
  const shelves = [{ id: 'a', position: 0 }, { id: 'b', position: 1 }, { id: 'c', position: 2 }];
  assert.deepEqual(moveShelf(shelves, 'c', -1), [{ id: 'c', position: 1 }, { id: 'b', position: 2 }]);
  assert.deepEqual(moveShelf(shelves, 'a', -1), []);
  assert.deepEqual(moveShelf(shelves, 'c', 1), []);
  assert.deepEqual(moveShelf([{ id: 'a', position: 0 }, { id: 'b', position: 0 }, { id: 'c', position: 5 }], 'a', 1), [{ id: 'a', position: 1 }, { id: 'c', position: 2 }]);
});
