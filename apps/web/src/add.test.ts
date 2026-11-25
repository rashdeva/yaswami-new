import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ADD_EXAMPLES, ADD_KINDS, segments } from './add.ts';

test('разметка примера: куски складываются в сообщение, каждое поле с источником найдено ровно раз', () => {
  for (const kind of ADD_KINDS) {
    const { message, fields } = ADD_EXAMPLES[kind];
    const parts = segments(message, fields);
    assert.equal(parts.map((p) => p.text).join(''), message, kind);
    const found = parts.flatMap((p) => (p.field === undefined ? [] : [p.field]));
    assert.deepEqual(found.sort(), fields.flatMap((f, i) => (f.source ? [i] : [])), kind);
  }
});

test('разметка: пересечение и отсутствующий источник пропускаются', () => {
  assert.deepEqual(segments('торт 55k', [{ label: 'a', value: '', source: 'торт 55' }, { label: 'b', value: '', source: '55k' }, { label: 'c', value: '', source: 'нет' }]), [
    { text: 'торт 55', field: 0 },
    { text: 'k' },
  ]);
});
