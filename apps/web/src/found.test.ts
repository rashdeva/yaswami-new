import assert from 'node:assert/strict';
import { test } from 'node:test';
import { foundCta, foundSignups, foundToAsk, plural } from './found.ts';

test('«это ваши события?»: спрашиваем о новых, считаем записавшихся, подпись кнопки по числу отмеченных', () => {
  const items = [{ id: 'a', signups_count: 8 }, { id: 'b', signups_count: 4 }, { id: 'c' }];
  assert.deepEqual(foundToAsk(items, ['b']).map((i) => i.id), ['a', 'c']);
  assert.deepEqual(foundToAsk(items, ['a', 'b', 'c']), []);
  assert.equal(foundSignups(items), 12);
  assert.deepEqual([foundCta(0), foundCta(1), foundCta(2), foundCta(3)], ['Это не мои события', 'Да, это моё событие', 'Да, оба мои', 'Да, все 3 мои']);
  assert.deepEqual([1, 2, 5, 11, 21, 104].map((n) => plural(n, 'человек', 'человека', 'человек')), ['человек', 'человека', 'человек', 'человек', 'человек', 'человека']);
});
