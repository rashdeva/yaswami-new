import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contactOf, hostEvents, matchCollected } from './catalog.ts';

const source = 'https://t.me/chan/5';

test('контакт для записи из ссылки «Записаться»', () => {
  assert.deepEqual(contactOf({ signup_url: 'https://t.me/Anya_K?text=hi', source_url: source }), { telegram_username: 'Anya_K', whatsapp_phone: null, url: null });
  assert.deepEqual(contactOf({ signup_url: 'https://wa.me/995555?text=hi', source_url: source }), { telegram_username: null, whatsapp_phone: '+995555', url: null });
  assert.deepEqual(contactOf({ signup_url: 'https://reg.example/x', source_url: source }), { telegram_username: null, whatsapp_phone: null, url: 'https://reg.example/x' });
  assert.deepEqual(contactOf({ signup_url: source, source_url: source }), { telegram_username: null, whatsapp_phone: null, url: null });
});

test('события организатора: по контакту или по каналу', () => {
  const items = [
    { id: 1, signup_url: 'https://t.me/anya_k?text=1', source_url: source, channel: 'other' },
    { id: 2, signup_url: source, source_url: source, channel: 'AnyaChan' },
    { id: 3, signup_url: source, source_url: source, channel: 'third' },
  ];
  assert.deepEqual(hostEvents({ username: 'Anya_K', channel: 'anyachan' }, items).map((e) => e.id), [1, 2]);
  assert.deepEqual(hostEvents({ username: 'nobody', channel: null }, items), []);
});

test('поиск по каталогу', () => {
  const e = { title: 'Йога на крыше', place: 'Ваке', channel: 'tbilisi_events' };
  assert.ok(matchCollected(e, 'йога'));
  assert.ok(matchCollected(e, ' ваке '));
  assert.ok(matchCollected(e, ''));
  assert.ok(!matchCollected(e, 'бег'));
});
