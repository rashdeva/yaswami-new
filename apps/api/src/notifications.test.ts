// Без базы и сети: разбор входящего сообщения, шаблоны уведомлений, лимиты виджета.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { deflateSync } from 'node:zlib';
import type { CollectedEventItem, Event } from '@yaswami/core';
import { ADDRESS_MAX, NAME_MAX } from '@yaswami/core';
import type { Card } from './notifications.ts';
import { notify, templates, toWidget, widgetHtml } from './notifications.ts';
import { bot, parseIncoming } from './telegram.ts';

const realCall = bot.call;
Object.assign(bot.pace, { globalMs: 0, chatMs: 0 }); // паузы очереди проверяет отдельный тест
afterEach(() => Object.assign(bot, { call: realCall, username: null }));

const event: Event = {
  id: 'e_0123456789', user_id: 1, kind: 'o', name: 'Йога на пляже', description: null,
  start_at: new Date('2026-11-14T19:00:00+07:00'), end_at: null, timezone: 'Asia/Ho_Chi_Minh',
  geo_address_json: { address: 'Пляж Микхе' }, meeting_url: null, max_capacity: 10, allow_plus_one: false,
  status: 'published', widget_id: null, rev: 0, created_at: new Date(),
};
const item: CollectedEventItem = {
  id: 'danangevent-7-0', title: 'Йога на пляже', description: '', starts_at: '2026-11-14T19:00:00+07:00', ends_at: null, place: null,
  address: null, price: null, tags: [], claimed_event_id: null, source_url: 'https://t.me/danangevent/7', signup_url: 'https://t.me/danangevent/7',
};
const from = { id: 5, first_name: 'Аня', username: 'anna_yoga', language_code: 'ru' };
const message = (extra: object) => ({ update_id: 1, message: { message_id: 9, date: 1794366000, chat: { id: 5, type: 'private' }, from, ...extra } });

test('входящее сообщение: текст, подпись к фото, пересланная публикация', () => {
  assert.deepEqual(parseIncoming(message({ text: ' Йога завтра ' })), {
    chatId: 5, messageId: 9, from, text: 'Йога завтра', publishedAt: new Date(1794366000 * 1000).toISOString(), authorUsername: 'anna_yoga', origin: null,
  });
  assert.equal(parseIncoming(message({ photo: [{}], caption: 'Афиша' }))?.text, 'Афиша');
  assert.equal(parseIncoming(message({ photo: [{}] }))?.text, '', 'фото без подписи');

  // Пересланное: дата и автор — от исходной публикации; канал автором не считается.
  const channel = parseIncoming(message({ text: 'x', forward_origin: { type: 'channel', date: 1794000000, chat: { username: 'danangevent' }, message_id: 7 } }))!;
  assert.deepEqual([channel.publishedAt, channel.authorUsername], [new Date(1794000000 * 1000).toISOString(), null]);
  assert.deepEqual(channel.origin?.channel, { id: undefined, username: 'danangevent', number: 7 });
  const user = parseIncoming(message({ text: 'x', forward_origin: { type: 'user', date: 1794000000, sender_user: { id: 8, username: 'igor' } } }))!;
  assert.deepEqual([user.authorUsername, user.origin], ['igor', { userId: 8, username: 'igor', channel: undefined }]);

  assert.equal(parseIncoming(message({ text: 'x', chat: { id: -100, type: 'supergroup' } })), null, 'группа');
  assert.equal(parseIncoming(message({ text: 'x', from: { ...from, is_bot: true } })), null, 'бот');
  assert.equal(parseIncoming({ update_id: 2, callback_query: {} }), null);
  assert.equal(parseIncoming(null), null);
});

test('шаблоны: у каждого момента своя карточка', () => {
  bot.username = 'yaswamibot';
  const link = { text: 'Открыть событие', url: 'https://t.me/yaswamibot/app?startapp=e_0123456789' };

  const created = templates.event_created({ event });
  assert.equal(created.label, 'Событие создано и подтверждено');
  assert.deepEqual(created.rows, [['🗓', 'сб, 14 ноября, 19:00'], ['📍', 'Пляж Микхе']]);
  assert.deepEqual(created.buttons, [link]);

  const guest = templates.guest_registered({ event, guests: [{ first_name: 'Дато', username: 'dato' }], going: 3 });
  assert.equal(guest.title, 'Дато придёт');
  assert.deepEqual(guest.rows.at(-1), ['👥', 'Записано: 3 из 10']);
  assert.deepEqual(guest.buttons, [{ text: 'Написать: Дато', url: 'https://t.me/dato' }, link]);
  // Без username написать по ссылке нельзя; без лимита мест — только число.
  const anon = templates.guest_registered({ event: { ...event, max_capacity: null }, guests: [{ first_name: 'Нино', username: null }], going: 1 });
  assert.deepEqual([anon.buttons, anon.rows.at(-1)], [[link], ['👥', 'Записано: 1']]);
  // Сводка: несколько записавшихся — одно уведомление.
  const people = ['Аня', 'Дато', 'Нино', 'Гия', 'Лена'].map((first_name, i) => ({ first_name, username: i === 1 ? null : `u${i}` }));
  const two = templates.guest_registered({ event, guests: people.slice(0, 2), going: 2 });
  assert.deepEqual([two.label, two.title], ['Новые записи', 'Аня и Дато придут']);
  const many = templates.guest_registered({ event, guests: people, going: 9 });
  assert.equal(many.title, 'Аня, Дато и ещё 3 придут');
  assert.deepEqual(many.buttons.map((b) => b.text), ['Написать: Аня', 'Написать: Нино', 'Написать: Гия', 'Открыть событие']);

  const collected = templates.event_collected({ item: { ...item, place: 'Пляж Микхе', address: 'ул. Во Нгуен Зяп' } });
  assert.equal(collected.label, 'Добавлено на витрину');
  assert.deepEqual(collected.rows, [['🗓', 'сб, 14 ноября, 19:00'], ['📍', 'Пляж Микхе, ул. Во Нгуен Зяп']]);
  assert.ok(collected.buttons[0]!.url.endsWith('/e/danangevent-7-0'));

  const confirmed = templates.rsvp_confirmed({ event: { ...event, start_at: new Date('2026-11-14T00:00:00+07:00'), geo_address_json: null } });
  assert.equal(confirmed.label, 'Вы записаны');
  assert.deepEqual(confirmed.rows, [['🗓', 'сб, 14 ноября']], 'время не указано — только день');
});

test('размер: код виджета ≤ 4096 байт после сжатия, состояние каждого шаблона ≤ 1024 байт', () => {
  // Telegram считает zlib уровня 9; сам HTML — не больше 32768 байт.
  assert.ok(Buffer.byteLength(widgetHtml) <= 32768);
  const packed = deflateSync(widgetHtml, { level: 9 }).length;
  assert.ok(packed <= 4096, `виджет ${packed} байт после сжатия`);
  assert.ok(!widgetHtml.includes('/*'), 'комментарии убраны');

  // Худший случай: поля предельной длины кириллицей, длинное имя гостя.
  bot.username = 'a'.repeat(32);
  const big: Event = { ...event, name: 'Щ'.repeat(NAME_MAX), geo_address_json: { address: 'Щ'.repeat(ADDRESS_MAX) }, max_capacity: 100000 };
  const cards: Record<keyof typeof templates, Card> = {
    event_created: templates.event_created({ event: big }),
    event_collected: templates.event_collected({ item: { ...item, id: 'x'.repeat(32) + '-1234567890-12', title: 'Щ'.repeat(500), place: 'Щ'.repeat(500) } }),
    guest_registered: templates.guest_registered({ event: big, guests: Array.from({ length: 500 }, () => ({ first_name: 'Щ'.repeat(64), username: 'b'.repeat(32) })), going: 100000 }),
    rsvp_confirmed: templates.rsvp_confirmed({ event: big }),
  };
  for (const [moment, card] of Object.entries(cards)) {
    const widget = toWidget(card);
    assert.equal(widget.html, widgetHtml);
    assert.ok(Buffer.byteLength(widget.public_data) <= 1024, `${moment}: состояние ${Buffer.byteLength(widget.public_data)} байт`);
    assert.ok([...widget.caption].length <= 1024, `${moment}: подпись`);
    for (const [b] of widget.reply_markup.inline_keyboard) assert.ok([...b!.text].length <= 64 && URL.canParse(b!.url), `${moment}: кнопка`);
  }
});

test('отправка: виджет, при отказе — обычное сообщение; сбой Telegram не бросает', async () => {
  const calls: [string, any][] = [];
  bot.call = async (method, body) => (calls.push([method, body]), { ok: true });
  await notify(5, 'rsvp_confirmed', { event });
  assert.deepEqual(calls.map(([m]) => m), ['sendWidget']);
  const sent = calls[0]![1];
  assert.equal(sent.chat_id, 5);
  assert.equal(sent.caption, '✅ Вы записаны: Йога на пляже\n🗓 сб, 14 ноября, 19:00\n📍 Пляж Микхе');
  assert.deepEqual(JSON.parse(sent.public_data), { e: '✅', c: ['#6366f1', '#a855f7'], l: 'Вы записаны', t: 'Йога на пляже', m: [['🗓', 'сб, 14 ноября, 19:00'], ['📍', 'Пляж Микхе']] });

  calls.length = 0;
  bot.call = async (method, body) => (calls.push([method, body]), { ok: method !== 'sendWidget', description: 'no widgets' });
  await notify(5, 'event_created', { event });
  assert.deepEqual(calls.map(([m]) => m), ['sendWidget', 'sendMessage']);
  assert.equal(calls[1]![1].text, calls[0]![1].caption);
  assert.deepEqual(calls[1]![1].reply_markup, calls[0]![1].reply_markup);

  const error = console.error;
  console.error = () => {};
  try {
    // Бота заблокировали или сработал лимит — второе сообщение не шлём.
    calls.length = 0;
    bot.call = async (method, body) => (calls.push([method, body]), { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' });
    await notify(5, 'event_created', { event });
    assert.deepEqual(calls.map(([m]) => m), ['sendWidget']);
    bot.call = async () => { throw new Error('network down'); };
    await notify(5, 'event_created', { event });
    bot.call = realCall; // без токена: ничего не уходит в сеть, отказ без исключения
    await notify(5, 'event_created', { event });
  } finally {
    console.error = error;
  }
});

test('очередь отправки: пауза между сообщениями в один чат, на 429 — ожидание и один повтор', async () => {
  const pace = { ...bot.pace };
  try {
    Object.assign(bot.pace, { globalMs: 0, chatMs: 60 });
    const at: [chat: number, ms: number][] = [];
    const start = Date.now();
    bot.call = async (_method, body) => (at.push([(body as { chat_id: number }).chat_id, Date.now() - start]), { ok: true });
    await Promise.all([bot.send('sendMessage', { chat_id: 901 }), bot.send('sendMessage', { chat_id: 901 }), bot.send('sendMessage', { chat_id: 902 })]);
    assert.deepEqual(at.map(([chat]) => chat), [901, 901, 902], 'порядок сохраняется');
    assert.ok(at[1]![1] - at[0]![1] >= 55, `второе сообщение в тот же чат через ${at[1]![1] - at[0]![1]} мс`);

    Object.assign(bot.pace, { chatMs: 0, retryAfterMaxS: 0.05 });
    let attempts = 0;
    bot.call = async () => (++attempts === 1 ? { ok: false, error_code: 429, parameters: { retry_after: 30 } } : { ok: true });
    assert.deepEqual(await bot.send('sendMessage', { chat_id: 903 }), { ok: true });
    assert.equal(attempts, 2);
    bot.call = async () => (attempts++, { ok: false, error_code: 429, parameters: { retry_after: 30 } });
    assert.equal((await bot.send('sendMessage', { chat_id: 903 })).ok, false, 'после повтора сдаёмся');
    assert.equal(attempts, 4);
  } finally {
    Object.assign(bot.pace, pace);
  }
});
