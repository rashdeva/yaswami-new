import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mediaLayout } from './media.ts';

test('медиа публикации: вертикальный ролик — в обложку, одно фото не показываем', () => {
  const photo = (n: number) => ({ type: 'photo' as const, url: `p${n}`, width: 1280, height: 960 });
  const tall = { type: 'video' as const, url: 'v9x16', width: 720, height: 1280 };
  const wide = { type: 'video' as const, url: 'v16x9', width: 1280, height: 720 };
  assert.deepEqual(mediaLayout(), { hero: null, gallery: [] });
  assert.deepEqual(mediaLayout([photo(1)]), { hero: null, gallery: [] }, 'одно фото');
  assert.deepEqual(mediaLayout([photo(1), photo(2)]), { hero: null, gallery: [photo(1), photo(2)] });
  assert.deepEqual(mediaLayout([tall]), { hero: tall, gallery: [] }, 'один вертикальный ролик — только обложка');
  assert.deepEqual(mediaLayout([photo(1), tall, photo(2)]), { hero: tall, gallery: [photo(1), photo(2)] });
  assert.deepEqual(mediaLayout([tall, photo(1)]), { hero: tall, gallery: [] }, 'после обложки осталось одно фото');
  assert.deepEqual(mediaLayout([wide]), { hero: null, gallery: [wide] }, 'горизонтальный ролик — в ленту, не в обложку');
  assert.deepEqual(mediaLayout([{ type: 'video', url: 'old' }]).hero, null, 'без размеров — не обложка');
});
