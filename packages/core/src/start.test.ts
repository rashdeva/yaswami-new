import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseStart, siteStart, startHostId } from './start.ts';

test('startapp: событие, кто позвал и метка источника — в любом сочетании', () => {
  assert.deepEqual(parseStart(undefined), { param: undefined, ref: undefined, tag: undefined });
  assert.deepEqual(parseStart('e_0a1b2c3d4e'), { param: 'e_0a1b2c3d4e', ref: undefined, tag: undefined });
  assert.deepEqual(parseStart('c_danangevent-5-0'), { param: 'c_danangevent-5-0', ref: undefined, tag: undefined });
  assert.deepEqual(parseStart('c_danangevent-5-0-r42'), { param: 'c_danangevent-5-0', ref: 42, tag: undefined });
  assert.deepEqual(parseStart('c_danangevent-5-0-sbanya_post'), { param: 'c_danangevent-5-0', ref: undefined, tag: 'banya_post' });
  assert.deepEqual(parseStart('e_0a1b2c3d4e-r42-sinsta'), { param: 'e_0a1b2c3d4e', ref: 42, tag: 'insta' });
  assert.deepEqual(parseStart('c_danangevent-5-0-r-7-sinsta'), { param: 'c_danangevent-5-0', ref: -7, tag: 'insta' }); // старые ссылки с отрицательным id до ADR-0008
  assert.deepEqual(parseStart('-sinsta_bio'), { param: undefined, ref: undefined, tag: 'insta_bio' }); // просто приложение, без события
  // К адресу прилип текст из «Поделиться»: событие всё равно открывается.
  assert.deepEqual(parseStart('c_yogaclubdanang-636-11 YOGA Hatha с Вильмой вс, 29 ноября, 10:00, Дананг'), { param: 'c_yogaclubdanang-636-11', ref: undefined, tag: undefined });
  assert.deepEqual(parseStart('e_0a1b2c3d4e-r42\nБаня'), { param: 'e_0a1b2c3d4e', ref: 42, tag: undefined });
});

test('ссылка прихода на сайт: startapp как есть, без него utm_source — меткой', () => {
  assert.equal(siteStart('?startapp=e_ab12-sinstagram'), 'e_ab12-sinstagram');
  assert.equal(siteStart('?utm_source=instagram&utm_medium=bio'), '-sinstagram');
  assert.equal(siteStart('?utm_source=ig.stories'), '-sig_stories');
  assert.equal(parseStart(siteStart('?utm_source=ig.stories')).tag, 'ig_stories');
  assert.equal(siteStart('?startapp=<script>'), undefined);
  assert.equal(siteStart(''), undefined);
});

test('startapp организатора: h_<id без дефисов> — его id, хвосты прихода не мешают', () => {
  const id = '7c2eb2aa-84ab-47e0-902a-1cda17980dae';
  assert.equal(startHostId(parseStart(`h_${id.replaceAll('-', '')}-r5-sig`).param), id);
  assert.equal(startHostId(parseStart('c_yoga-636-11').param), null);
  assert.equal(startHostId('h_123'), null);
});
