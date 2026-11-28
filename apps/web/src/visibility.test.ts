import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shortLink, showcaseState } from './visibility.ts';

test('видимость события: что организатор видит о своём событии в афише', () => {
  const of = (visibility: 'public' | 'private', status: 'draft' | 'published' | 'cancelled', showcase_status: 'pending' | 'approved' | 'published' | 'rejected' | null) =>
    showcaseState({ visibility, status, showcase_status });
  assert.deepEqual([of('private', 'published', null).badge, of('private', 'published', null).wanted], ['Только по ссылке', false]);
  // Приватное с прежним решением команды — всё равно только по ссылке.
  assert.equal(of('private', 'published', 'published').badge, 'Только по ссылке');
  assert.deepEqual([of('public', 'published', 'pending').badge, of('public', 'published', 'approved').badge], ['На проверке', 'На проверке']);
  assert.deepEqual([of('public', 'published', 'published').badge, of('public', 'published', 'published').tone], ['В афише', 'on']);
  assert.deepEqual([of('public', 'published', 'rejected').badge, of('public', 'published', 'rejected').tone], ['Не в афише', 'no']);
  assert.equal(of('public', 'draft', null).badge, 'Черновик');
  assert.equal(of('public', 'cancelled', 'published').badge, 'Отменено');
  assert.equal(shortLink('https://t.me/yaswamibot/app?startapp=e_1'), 't.me/yaswamibot/app?startapp=e_1');
});
