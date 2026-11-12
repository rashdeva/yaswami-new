import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseStart } from './start.ts';

test('startapp: событие, кто позвал и метка источника — в любом сочетании', () => {
  assert.deepEqual(parseStart(undefined), { param: undefined, ref: undefined, tag: undefined });
  assert.deepEqual(parseStart('e_0a1b2c3d4e'), { param: 'e_0a1b2c3d4e', ref: undefined, tag: undefined });
  assert.deepEqual(parseStart('c_danangevent-5-0'), { param: 'c_danangevent-5-0', ref: undefined, tag: undefined });
  assert.deepEqual(parseStart('c_danangevent-5-0-r42'), { param: 'c_danangevent-5-0', ref: 42, tag: undefined });
  assert.deepEqual(parseStart('c_danangevent-5-0-sbanya_post'), { param: 'c_danangevent-5-0', ref: undefined, tag: 'banya_post' });
  assert.deepEqual(parseStart('e_0a1b2c3d4e-r42-sinsta'), { param: 'e_0a1b2c3d4e', ref: 42, tag: 'insta' });
  assert.deepEqual(parseStart('-sinsta_bio'), { param: undefined, ref: undefined, tag: 'insta_bio' }); // просто приложение, без события
});
