// Тесты на настоящем Postgres (нужен `pnpm db:up`). Работают в отдельной базе yaswami_test_<checkout>, рабочую не трогают.
import assert from 'node:assert/strict';
import { createHash, createHmac, generateKeyPairSync, sign } from 'node:crypto';
import { after, before, mock, test } from 'node:test';
import { asc, eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import type { AdminCollectedEvent, AdminOverview, CollectedEventItem, Contact, Conversation, EventView, InboxFeed, Me, Message, TgAccount } from '@yaswami/core';
import { createApp } from './app.ts';
import { handleUpdate, REPLIES } from './bot.ts';
import { bot } from './telegram.ts';
import type { CollectedEvent } from '@yaswami/core';
import { issueToken, verifyInitData } from './auth.ts';
import type { Db } from './db/client.ts';
import { createDb } from './db/client.ts';
import { collectedEvents, hosts, photos, visits, tgAccounts } from './db/schema.ts';
import { saveUserPhoto } from './photos.ts';
import { listCollectedForAdmin, requestNextVideo } from './services.ts';
import { settings } from './settings.ts';
import { digestFeedback, requestFeedback } from './feedback.ts';
import { eventFeedback, events as eventsTable } from './db/schema.ts';

import { host, hunter, illustrator, parseIllustration, parseSupportReply, support, verifyTicket } from './support.ts';
import { recordHostLead, recordLead } from './inbox.ts';
import { eventPage, feedPage, inject, sitemap } from './pages.ts';
import { ISSUER, safeReturn, verifyIdToken } from './web-login.ts';

const BOT_TOKEN = '123456:test-token';
const url = new URL(process.env.DATABASE_URL ?? 'postgres://yaswami:yaswami@localhost:5432/yaswami');
let db: Db;
let app: ReturnType<typeof createApp>;

// Postgres на машине один на все git worktree, а тесты чистят и наполняют свою базу: у каждого checkout она своя,
// иначе две сессии, запустившие тесты одновременно, ломают друг другу данные. Имя — по пути checkout (корень репозитория
// от этого файла), так что оно не зависит от того, откуда запущены тесты.
// ponytail: базы удалённых worktree остаются на сервере; мешать они не мешают, чистить — `drop database` руками.
const TEST_DB = `yaswami_test_${createHash('sha256').update(new URL('../../..', import.meta.url).pathname).digest('hex').slice(0, 8)}`;

before(async () => {
  const admin = postgres(url.href, { max: 1 });
  const [found] = await admin`select 1 from pg_database where datname = ${TEST_DB}`;
  if (!found) await admin`create database ${admin(TEST_DB)}`;
  await admin.end();
  url.pathname = `/${TEST_DB}`;
  db = createDb(url.href);
  await migrate(db, { migrationsFolder: new URL('../drizzle', import.meta.url).pathname });
  await db.execute(sql`truncate users cascade`);
  app = createApp({ db, botToken: BOT_TOKEN });
});
after(() => db.$client.end());

// Всё, что бот «отправил» за тест. Настоящих запросов к Telegram нет.
const sent: [method: string, body: any][] = [];
let lastMessageId = 5000;
bot.call = async (method, body) => (sent.push([method, body]), { ok: true, result: { message_id: ++lastMessageId } });
Object.assign(bot.pace, { globalMs: 0, chatMs: 0 });

function initData(id: number, first_name: string, authDate = Math.floor(Date.now() / 1000)) {
  const params = new URLSearchParams({ auth_date: String(authDate), user: JSON.stringify({ id, first_name, username: `u${id}` }) });
  const check = [...params].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}
const tma = (id: number, name: string) => `tma ${initData(id, name)}`;
const call = (auth: string, method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { authorization: auth, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const newEvent = async (auth: string, extra: object = {}) => {
  const res = await call(auth, 'POST', '/events', { kind: 's', name: 'Футбол 5×5', start_at: '2026-11-20T19:00:00+04:00', timezone: 'Asia/Tbilisi', ...extra });
  assert.equal(res.status, 201);
  return (await res.json()) as EventView;
};

test('initData: чужая подпись и устаревшие данные не проходят', async () => {
  assert.equal(verifyInitData(initData(1, 'Миша'), BOT_TOKEN)?.id, 1);
  assert.equal(verifyInitData(initData(1, 'Миша'), 'other:token'), null);
  assert.equal(verifyInitData(initData(1, 'Миша', 1), BOT_TOKEN), null);
  assert.equal(verifyInitData(initData(1, 'Миша').replace('%D0%9C', '%D0%9D'), BOT_TOKEN), null);
  assert.equal((await call('tma garbage', 'GET', '/events')).status, 401);
  assert.equal((await app.request('/events')).status, 401);

  // Без токена бота вход через Telegram закрыт — даже для подписи, сделанной пустым ключом.
  const noBot = createApp({ db, botToken: '' });
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 1, first_name: 'x' }) });
  const secret = createHmac('sha256', 'WebAppData').update('').digest();
  params.set('hash', createHmac('sha256', secret).update([...params].map(([k, v]) => `${k}=${v}`).sort().join('\n')).digest('hex'));
  assert.equal((await noBot.request('/events', { headers: { authorization: `tma ${params}` } })).status, 401);
});

test('событие создаётся с типом билета по умолчанию; гость записывается, виден только по имени', async () => {
  const host = tma(1, 'Миша');
  const created = await newEvent(host);
  assert.equal(created.ticket_types.length, 1);
  assert.equal(created.host.first_name, 'Миша');
  assert.equal(created.event.start_at, '2026-11-20T15:00:00.000Z');

  const res = await call(tma(2, 'Дато'), 'POST', `/events/${created.event.id}/rsvp`, { approval_status: 'approved' });
  assert.equal(res.status, 200);
  const view = (await res.json()) as EventView;
  assert.deepEqual(view.guest_counts, { approved: 1, maybe: 0, declined: 0 });
  assert.equal(view.event.rev, 1);
  assert.deepEqual(view.guests, [
    { user_first_name: 'Дато', user_photo_url: null, approval_status: 'approved', event_ticket_type_id: created.ticket_types[0]!.id, plus_ones: 0, is_me: true },
  ]);
  assert.equal(view.is_host, false);

  const list = (await (await call(tma(2, 'Дато'), 'GET', '/events')).json()) as { my_approval_status: string; is_host: boolean }[];
  assert.deepEqual(list.map((e) => [e.my_approval_status, e.is_host]), [['approved', false]]);
});

test('билеты задаются при создании: цена — свободный текст, имя по умолчанию, порядок сохраняется', async () => {
  const host = tma(1, 'Миша');
  const one = await newEvent(host, { ticket_types: [{ price_text: 'по донату' }] });
  assert.deepEqual(one.ticket_types.map((t) => [t.name, t.price_text]), [['Стандартный', 'по донату']]);
  const many = await newEvent(host, { ticket_types: [{ name: 'Early bird', price_text: '1000 ₽' }, { name: 'Обычный', price_text: '1500 ₽' }] });
  assert.deepEqual(many.ticket_types.map((t) => [t.name, t.price_text, t.position]), [['Early bird', '1000 ₽', 0], ['Обычный', '1500 ₽', 1]]);
});

test('«О событии»: у нового пусто, организатор дописывает, чужой не может', async () => {
  const host = tma(1, 'Миша');
  const { event } = await newEvent(host);
  assert.deepEqual([event.what_happens, event.for_whom, event.guide], [[], null, null]);
  const about = { topic: 'танцы', what_happens: ['Разминка', 'Танец в парах'], for_whom: 'Всем', beginner_friendly: true, takeaway: null, guide: { what: 'a', why: 'b', first: 'c', not_for: 'd' } };
  const res = await call(host, 'PATCH', `/events/${event.id}`, about);
  assert.equal(res.status, 200);
  const saved = ((await res.json()) as EventView).event;
  assert.deepEqual({ ...about, takeaway: saved.takeaway }, { ...about, takeaway: null });
  assert.deepEqual([saved.topic, saved.what_happens, saved.guide], [about.topic, about.what_happens, about.guide]);
  assert.equal((await call(tma(2, 'Дато'), 'PATCH', `/events/${event.id}`, about)).status, 403);
});

test('последнее место достаётся одному из восьми одновременных гостей', async () => {
  const { event } = await newEvent(tma(1, 'Миша'), { max_capacity: 1 });
  // Сначала вход (создаёт пользователей и прогревает соединения), чтобы ответы стартовали действительно одновременно.
  const ids = Array.from({ length: 8 }, (_, i) => 30 + i);
  await Promise.all(ids.map((id) => call(tma(id, `G${id}`), 'GET', '/events')));
  const results = await Promise.all(ids.map((id) => call(tma(id, `G${id}`), 'POST', `/events/${event.id}/rsvp`, { approval_status: 'approved' })));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, ...Array(7).fill(409)]);
  const full = results.find((r) => r.status === 409)!;
  assert.deepEqual(await full.json(), { error: 'full' });
});

test('менять событие и типы билетов может только организатор; черновик чужим не виден', async () => {
  const host = tma(1, 'Миша');
  const guest = tma(2, 'Дато');
  const { event, ticket_types } = await newEvent(host, { status: 'draft' });
  assert.equal((await call(guest, 'GET', `/events/${event.id}`)).status, 404);
  assert.equal((await call(host, 'PATCH', `/events/${event.id}`, { status: 'published' })).status, 200);
  assert.equal((await call(guest, 'PATCH', `/events/${event.id}`, { name: 'x' })).status, 403);
  assert.equal((await call(guest, 'POST', `/events/${event.id}/ticket-types`, { name: 'VIP' })).status, 403);
  assert.equal((await call(host, 'PATCH', `/events/${event.id}`, { name: '' })).status, 400);

  // последний тип не удалить; второй, пока его держит гость, — тоже
  const only = ticket_types[0]!.id;
  assert.deepEqual(await (await call(host, 'DELETE', `/ticket-types/${only}`)).json(), { error: 'ticket_type_last' });
  const vip = (await (await call(host, 'POST', `/events/${event.id}/ticket-types`, { name: 'VIP', max_capacity: 1 })).json()) as { id: string };
  assert.deepEqual(await (await call(guest, 'POST', `/events/${event.id}/rsvp`, { approval_status: 'approved' })).json(), { error: 'ticket_required' });
  assert.equal((await call(guest, 'POST', `/events/${event.id}/rsvp`, { approval_status: 'approved', event_ticket_type_id: vip.id })).status, 200);
  assert.deepEqual(await (await call(host, 'DELETE', `/ticket-types/${vip.id}`)).json(), { error: 'ticket_type_in_use' });
  assert.equal((await call(host, 'DELETE', `/ticket-types/${only}`)).status, 204);
});

test('токен: выпускается только из мини-приложения, отзывается, даёт доступ к REST', async () => {
  const issued = await call(tma(7, 'Ника'), 'POST', '/tokens');
  assert.equal(issued.status, 201);
  const bearer = `Bearer ${((await issued.json()) as { token: string }).token}`;
  assert.equal((await call(bearer, 'GET', '/events')).status, 200);
  assert.equal((await call(bearer, 'POST', '/tokens')).status, 403);
  assert.equal((await call(bearer, 'DELETE', '/tokens')).status, 204);
  assert.equal((await call(bearer, 'GET', '/events')).status, 401);
});

test('MCP: список инструментов, создание события и ошибка правил как ответ инструмента', async () => {
  await call(tma(8, 'Саша'), 'GET', '/events'); // первый вход создаёт пользователя
  const bearer = `Bearer ${await issueToken(db, 8)}`;
  const rpc = async (method: string, params: object) => {
    const res = await call(bearer, 'POST', '/mcp', { jsonrpc: '2.0', id: 1, method, params });
    assert.equal(res.status, 200);
    return ((await res.json()) as { result: any }).result;
  };
  assert.equal((await call('Bearer ysw_nope', 'POST', '/mcp', {})).status, 401);

  const { tools } = await rpc('tools/list', {});
  assert.deepEqual(tools.map((t: { name: string }) => t.name).sort(), [
    'collected_events_claim', 'collected_events_get', 'collected_events_list', 'collected_events_signup', 'contacts_list',
    'events_create', 'events_get', 'events_list', 'events_rsvp', 'events_ticket_types_create', 'events_ticket_types_delete',
    'events_ticket_types_update', 'events_update', 'me_collected_list', 'users_get_self',
  ]);
  const create = tools.find((t: { name: string }) => t.name === 'events_create');
  assert.deepEqual(create.inputSchema.required.sort(), ['kind', 'name', 'start_at', 'timezone']);

  const created = await rpc('tools/call', {
    name: 'events_create',
    arguments: { kind: 'c', name: 'Кофе', start_at: '2026-12-01T10:00:00+04:00', timezone: 'Asia/Tbilisi', max_capacity: 1 },
  });
  const view = JSON.parse(created.content[0].text) as EventView;
  assert.equal(view.is_host, true);

  // событие, созданное через MCP, видно в REST
  await call(tma(9, 'Лёша'), 'POST', `/events/${view.event.id}/rsvp`, { approval_status: 'approved' });
  const full = await rpc('tools/call', { name: 'events_rsvp', arguments: { event_id: view.event.id, approval_status: 'approved' } });
  assert.equal(full.isError, true);
  assert.deepEqual(JSON.parse(full.content[0].text), { error: 'full' });

  const invalid = await rpc('tools/call', { name: 'events_create', arguments: { kind: 'zzz', name: 'x' } });
  assert.equal(invalid.isError, true);
});

test('собранные события: витрина без входа, запись — после входа, вход по cookie сайта', async () => {
  await db.delete(collectedEvents);
  const row = (external_id: string, starts_at: Date) => ({
    external_id, channel: 'danangevent', starts_at, signup_url: 'https://t.me/anna_yoga?text=hi', status: 'published' as const,
    announcement: { url: 'https://t.me/danangevent/1' },
    event: {
      title: 'Йога', description: 'Практика на пляже', starts_at: starts_at.toISOString(), ends_at: null, place: 'My Khe',
      address: null, price: '100k', tags: ['йога'], telegram_username: 'anna_yoga', whatsapp_phone: null, url: null,
    },
  });
  await db.insert(collectedEvents).values([
    row('telegram:danangevent/1#0', new Date(Date.now() + 86_400_000)),
    row('telegram:danangevent/2#0', new Date(Date.now() - 86_400_000)),
    { ...row('telegram:danangevent/3#0', new Date(Date.now() + 2 * 86_400_000)), reactions: 12 },
  ]);

  // витрина: только предстоящие, контакт организатора — только внутри ссылки записи
  const items = (await (await app.request('/collected-events')).json()) as CollectedEventItem[];
  assert.deepEqual(items.map((i) => [i.id, i.popular, i.reactions]), [['danangevent-1-0', false, null], ['danangevent-3-0', true, 12]]);
  assert.equal(((await (await app.request('/collected-events/danangevent-3-0')).json()) as CollectedEventItem).popular, true);
  // ссылка записи собирается заново: в сообщении организатору — страница события на Ясвами
  const link = new URL(items[0]!.signup_url);
  assert.equal(link.origin + link.pathname, 'https://t.me/anna_yoga');
  assert.match(link.searchParams.get('text')!, /«Йога».*Ясвами: http:\/\/localhost:\d+\/e\/danangevent-1-0$/);
  assert.equal('telegram_username' in items[0]!, false);

  // страница события открывается по id из адреса; прошедшее тоже, несуществующее — 404
  assert.equal(((await (await app.request('/collected-events/danangevent-2-0')).json()) as CollectedEventItem).source_url, 'https://t.me/danangevent/1');
  assert.equal((await app.request('/collected-events/danangevent-9-0')).status, 404);
  assert.equal((await app.request('/collected-events/garbage')).status, 404);

  // запись требует входа и не задваивается
  assert.equal((await app.request('/collected-events/danangevent-1-0/signup', { method: 'POST' })).status, 401);
  const guest = tma(20, 'Оля');
  assert.equal((await call(guest, 'POST', '/collected-events/danangevent-1-0/signup')).status, 200);
  assert.equal((await call(guest, 'POST', '/collected-events/danangevent-1-0/signup')).status, 200);
  assert.deepEqual(await (await call(guest, 'GET', '/me')).json(), { user: { id: 20, first_name: 'Оля' }, collected_signups: ['danangevent-1-0'], claimable: [] });

  // «Мои события»: куда записывался и куда только заходил
  assert.equal((await call(guest, 'POST', '/collected-events/danangevent-2-0/visit', {})).status, 204);
  const mine = (await (await call(guest, 'GET', '/me/collected')).json()) as { event: CollectedEventItem; signed_up: boolean }[];
  assert.deepEqual(mine.map((m) => [m.event.id, m.signed_up]).sort(), [['danangevent-1-0', true], ['danangevent-2-0', false]]);
  assert.deepEqual(await (await call(tma(21, 'Пусто'), 'GET', '/me/collected')).json(), []);

  // токен в cookie сайта входит так же, как в заголовке; после выхода он больше не действует
  const session = `ysw_session=${await issueToken(db, 20)}`;
  assert.equal((await app.request('/me', { headers: { cookie: session } })).status, 200);
  assert.equal((await app.request('/auth/logout', { method: 'POST', headers: { cookie: session } })).status, 204);
  assert.equal((await app.request('/me', { headers: { cookie: session } })).status, 401);
});

test('подтверждение владельцем: предлагается по username, создаёт событие, второй раз и чужим — нельзя', async () => {
  await db.delete(collectedEvents);
  const starts_at = new Date(Date.now() + 86_400_000);
  await db.insert(collectedEvents).values({
    external_id: 'telegram:danangevent/5#0', channel: 'danangevent', status: 'published' as const, starts_at, signup_url: '',
    announcement: { url: 'https://t.me/danangevent/5' },
    event: {
      title: 'Бачата с нуля ' + 'очень '.repeat(20), description: 'Урок для начинающих', starts_at: starts_at.toISOString(), ends_at: null,
      place: 'Studio', address: 'An Thuong 4', price: '150k', tags: [], telegram_username: 'U30', whatsapp_phone: null, url: null,
    },
    telegram_username: 'u30', // сборщик хранит контакт в нижнем регистре; у пользователя из tma() username — u<id>
  });
  // профиль организатора собран сборщиком до его входа: привяжется к пользователю по Telegram id, когда тот войдёт
  await db.delete(hosts);
  await db.insert(hosts).values({ telegram_id: 30, username: 'u30', name: 'Ксения', channel: 'ksenia_dance', summary: 'Преподаёт бачату.' });
  assert.equal(((await (await app.request('/collected-events/danangevent-5-0')).json()) as CollectedEventItem).hosts![0]!.confirmed, false);
  const owner = tma(30, 'Ксения');
  const stranger = tma(31, 'Олег');

  const mine = (await (await call(owner, 'GET', '/me')).json()) as Me;
  assert.deepEqual(mine.claimable.map((c) => c.id), ['danangevent-5-0']);
  assert.deepEqual(((await (await call(stranger, 'GET', '/me')).json()) as Me).claimable, []);
  assert.equal((await call(stranger, 'POST', '/collected-events/danangevent-5-0/claim')).status, 403);

  const res = await call(owner, 'POST', '/collected-events/danangevent-5-0/claim');
  assert.equal(res.status, 201);
  const view = (await res.json()) as EventView;
  assert.equal(view.is_host, true);
  assert.equal(view.event.name.length, 60); // длинное название обрезано до лимита события
  assert.deepEqual(
    { status: view.event.status, timezone: view.event.timezone, address: view.event.geo_address_json, price: view.ticket_types[0]!.price_text },
    { status: 'published', timezone: 'Asia/Ho_Chi_Minh', address: { address: 'Studio, An Thuong 4' }, price: '150k' },
  );

  // витрина теперь ведёт на событие Ясвами, повторно подтвердить нельзя, предложение исчезло
  const item = (await (await app.request('/collected-events/danangevent-5-0')).json()) as CollectedEventItem;
  assert.deepEqual(item.hosts, [{ name: 'Ксения', summary: 'Преподаёт бачату.', channel_url: 'https://t.me/ksenia_dance', photo_url: 'https://t.me/i/userpic/320/u30.jpg', confirmed: true, photos: [] }]);
  assert.equal(item.claimed_event_id, view.event.id);
  assert.equal((await call(owner, 'POST', '/collected-events/danangevent-5-0/claim')).status, 409);
  assert.deepEqual(((await (await call(owner, 'GET', '/me')).json()) as Me).claimable, []);
});

test('лимит бесплатных событий: сверх него создать нельзя, подтверждённые тоже считаются', async () => {
  const host = tma(40, 'Лена');
  const limit = settings.freeEventsLimit;
  settings.freeEventsLimit = 2;
  try {
    await newEvent(host);
    await newEvent(host);
    const res = await call(host, 'POST', '/events', { kind: 's', name: 'Третье', start_at: '2026-11-20T19:00:00+04:00', timezone: 'Asia/Tbilisi' });
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: 'events_limit' });
    await newEvent(tma(41, 'Другой')); // лимит у каждого свой
  } finally {
    settings.freeEventsLimit = limit;
  }
  assert.equal(((await (await app.request('/config')).json()) as { free_events_limit: number }).free_events_limit, limit);
});

test('вход с сайта: выключен без Client Secret, возврат — только на свой сайт, id_token проверяется', async () => {
  assert.equal(((await (await app.request('/config')).json()) as { web_login: boolean }).web_login, false);
  assert.equal((await app.request('/auth/telegram/login')).status, 503);

  const web = createApp({ db, botToken: BOT_TOKEN, webLogin: { clientSecret: 'secret', publicUrl: 'https://yaswami.test' } });
  const res = await web.request('/auth/telegram/login?return=/e/danangevent-1-0');
  assert.equal(res.status, 302);
  const to = new URL(res.headers.get('location')!);
  assert.equal(to.origin, ISSUER);
  assert.equal(to.searchParams.get('client_id'), '123456');
  assert.equal(to.searchParams.get('redirect_uri'), 'https://yaswami.test/api/auth/telegram/callback');
  assert.match(res.headers.get('set-cookie')!, /ysw_login=.*HttpOnly.*Secure/s);
  // чужой или просроченный возврат не проходит
  assert.equal((await web.request('/auth/telegram/callback?code=x&state=y')).status, 400);

  assert.equal(safeReturn('/e/x?signup=1'), '/e/x?signup=1');
  for (const bad of ['//evil.test', '/\\evil.test', 'https://evil.test', undefined]) assert.equal(safeReturn(bad), '/');

  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwks = [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' }];
  const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const make = (claims: object, key = privateKey, head: object = { alg: 'RS256', kid: 'k1' }) => {
    const body = `${b64(head)}.${b64(claims)}`;
    return `${body}.${sign('sha256', Buffer.from(body), key).toString('base64url')}`;
  };
  const ok = { iss: ISSUER, aud: '42', id: 7, name: 'Аня', exp: 2000 };
  assert.equal(verifyIdToken(make(ok), jwks, '42', 1000).id, 7);
  assert.throws(() => verifyIdToken(make(ok), jwks, '43', 1000), /audience/);
  assert.throws(() => verifyIdToken(make(ok), jwks, '42', 3000), /expired/);
  assert.throws(() => verifyIdToken(make({ ...ok, iss: 'https://evil.test' }), jwks, '42', 1000), /issuer/);
  assert.throws(() => verifyIdToken(make(ok, generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey), jwks, '42', 1000), /signature/);
  assert.throws(() => verifyIdToken(make(ok, privateKey, { alg: 'none' }), jwks, '42', 1000), /unsupported/);
});

test('страницы для поисковиков: содержимое и разметка экранированы', () => {
  const event: CollectedEventItem = {
    id: 'danangevent-1-0', title: 'Йога <b>& чай</b>', description: '</script><script>alert(1)</script> $& утро',
    starts_at: '2026-11-14T19:00:00+07:00', ends_at: null, place: 'My Khe', address: null, price: '100k', tags: [],
    topic: 'баня', what_happens: ['Парение <i>'], takeaway: null,
    signup_url: 'https://t.me/anna_yoga', source_url: 'https://t.me/danangevent/1', claimed_event_id: null,
  };
  const template = '<html><head><title>Я с вами</title></head><body><div id="app"></div></body></html>';
  const html = inject(template, eventPage(event, 'https://yaswami.test', 'Дананг'));
  assert.match(html, /<title>Йога &#60;b&#62;&#38; чай&#60;\/b&#62; — сб, 14 ноября, 19:00, Дананг<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/yaswami.test\/e\/danangevent-1-0" \/>/);
  assert.match(html, /"startDate":"2026-11-14T19:00:00\+07:00"/);
  assert.match(html, /<ol><li>Парение &#60;i&#62;<\/li><\/ol><h2>баня — что это<\/h2><p>Парная/); // шаги события и гид по Topic
  assert.equal(html.includes('<script>alert(1)'), false);
  assert.equal(html.includes('$& утро'), true); // «$&» в тексте не превратилось в кусок шаблона
  assert.equal((html.match(/<\/script>/g) ?? []).length, 2); // только свои: JSON-LD и начальные данные

  const feed = inject(template, feedPage([event], 'https://yaswami.test', 'Дананг'));
  assert.match(feed, /<h2>суббота, 14 ноября<\/h2><ul><li><a href="\/e\/danangevent-1-0">/);
  assert.match(sitemap([event], 'https://yaswami.test'), /<loc>https:\/\/yaswami.test\/e\/danangevent-1-0<\/loc>/);
});

const HOUR = 3600e3;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19) + '+00:00';
const extracted = (extra: Partial<CollectedEvent> = {}): CollectedEvent => ({
  title: 'Йога на пляже', description: 'Утренняя практика для всех.', starts_at: iso(Date.now() + 48 * HOUR), ends_at: null,
  place: 'Пляж Микхе', address: null, price: 'донейшн', tags: ['йога'], telegram_username: null, whatsapp_phone: null, url: null, ...extra,
});
const ANNOUNCEMENT = 'Йога на пляже в субботу в 7 утра — приходите все, будет очень душевно';
const botMessage = (id: number, text: string, extra: object = {}) =>
  ({ update_id: 1, message: { message_id: 1, date: Math.floor(Date.now() / 1000), chat: { id, type: 'private' }, from: { id, first_name: 'Аня', username: `u${id}` }, text, ...extra } });

test('вебхук бота: без секрета закрыт, с чужим секретом — отказ', async () => {
  const post = (a: ReturnType<typeof createApp>, secret?: string) =>
    a.request('/telegram/webhook', { method: 'POST', headers: { 'content-type': 'application/json', ...(secret ? { 'x-telegram-bot-api-secret-token': secret } : {}) }, body: JSON.stringify({ update_id: 1 }) });
  assert.equal((await post(app, 'anything')).status, 403, 'секрет не настроен');
  const hooked = createApp({ db, botToken: BOT_TOKEN, telegram: { webhookSecret: 's3cret' } });
  assert.equal((await post(hooked)).status, 403);
  assert.equal((await post(hooked, 's3creT')).status, 403);
  assert.equal((await post(hooked, 's3cret')).status, 200);
});

test('сообщение боту: анонс становится событием отправителя, ответ — виджет', async () => {
  sent.length = 0;
  const seen: unknown[] = [];
  // Переслал своё же сообщение — это по-прежнему его анонс; дата публикации берётся от исходного.
  const self = { type: 'user', date: 1794000000, sender_user: { id: 60, username: 'u60' } };
  await handleUpdate(db, async (a) => (seen.push(a), [extracted()]), botMessage(60, ANNOUNCEMENT, { forward_origin: self }));
  assert.deepEqual(seen, [{ id: 'bot/60/1', text: ANNOUNCEMENT, published_at: new Date(1794000000 * 1000).toISOString(), author_username: 'u60' }]);

  const mine = (await (await call(tma(60, 'Аня'), 'GET', '/events')).json()) as { event: EventView['event']; is_host: boolean }[];
  assert.deepEqual(mine.map((e) => [e.event.name, e.event.status, e.is_host, e.event.geo_address_json]), [['Йога на пляже', 'published', true, { address: 'Пляж Микхе' }]]);
  const view = (await (await call(tma(60, 'Аня'), 'GET', `/events/${mine[0]!.event.id}`)).json()) as EventView;
  assert.equal(view.ticket_types[0]!.price_text, 'донейшн');

  assert.deepEqual(sent.map(([m, b]) => [m, b.chat_id]), [['sendWidget', 60]]);
  assert.equal(JSON.parse(sent[0]![1].public_data).l, 'Событие создано и подтверждено');
  assert.ok(sent[0]![1].reply_markup.inline_keyboard[0][0].url.endsWith(`startapp=${mine[0]!.event.id}`));
});

test('сообщение боту: отказы и лимит бесплатных событий', async () => {
  const reply = async (extract: Parameters<typeof handleUpdate>[1], text: string, extra?: object) => {
    sent.length = 0;
    await handleUpdate(db, extract, botMessage(61, text, extra));
    return sent.map(([m, b]) => (m === 'sendMessage' ? b.text : m));
  };
  const never = async () => assert.fail('ИИ вызывать не нужно');
  assert.deepEqual(await reply(never, '/start'), [REPLIES.help]);
  assert.deepEqual(await reply(never, ''), [REPLIES.help], 'фото без подписи');
  assert.deepEqual(await reply(never, 'Сдаётся квартира у моря, две спальни, недорого, пишите в личку'), [REPLIES.no_date]);
  assert.deepEqual(await reply(undefined, ANNOUNCEMENT), [REPLIES.unavailable], 'нет ключа Gemini');
  assert.deepEqual(await reply(async () => [], ANNOUNCEMENT), [REPLIES.not_event]);
  assert.deepEqual(await reply(async () => [extracted({ starts_at: 'в субботу' })], ANNOUNCEMENT), [REPLIES.not_event], 'дата не определена');
  assert.deepEqual(await reply(async () => [extracted({ starts_at: iso(Date.now() - 48 * HOUR) })], ANNOUNCEMENT), [REPLIES.past]);
  const error = console.error;
  console.error = () => {};
  assert.deepEqual(await reply(async () => { throw new Error('429'); }, ANNOUNCEMENT), [REPLIES.unavailable]);
  console.error = error;
  assert.deepEqual(await (await call(tma(61, 'Аня'), 'GET', '/events')).json(), [], 'ни один отказ события не создал');

  // Не больше нескольких разборов в минуту от одного человека: ИИ ограничен по запросам.
  const perMinute = settings.botMessagesPerMinute;
  settings.botMessagesPerMinute = 4; // четыре разбора выше уже были
  assert.deepEqual(await reply(never, ANNOUNCEMENT), [REPLIES.too_often]);
  settings.botMessagesPerMinute = perMinute + 100;

  // Расписание: каждое событие отдельно, пока хватает лимита; остальное — понятный отказ.
  const limit = settings.freeEventsLimit;
  settings.freeEventsLimit = 2;
  try {
    const week = [1, 2, 3, 4].map((d) => extracted({ title: `Йога, день ${d}`, starts_at: iso(Date.now() + d * 24 * HOUR) }));
    assert.deepEqual(await reply(async () => week, ANNOUNCEMENT), ['sendWidget', 'sendWidget', REPLIES.limit(2)]);
    assert.equal(((await (await call(tma(61, 'Аня'), 'GET', '/events')).json()) as unknown[]).length, 2);
  } finally {
    settings.freeEventsLimit = limit;
  }
});

test('сообщение боту: то же собранное событие подтверждается только за своим контактом', async () => {
  const e = extracted({ title: 'Коллажный кружок', telegram_username: 'u62' });
  const row = (n: number) => ({
    external_id: `telegram:danangevent/${n}#0`, channel: 'danangevent', announcement: { url: `https://t.me/danangevent/${n}` },
    event: e, starts_at: new Date(e.starts_at), telegram_username: 'u62', signup_url: 'https://t.me/u62', status: 'published' as const,
  });
  await db.insert(collectedEvents).values([row(901), row(902)]);
  const claimed = async (n: number) => ((await (await app.request(`/collected-events/danangevent-${n}-0`)).json()) as CollectedEventItem).claimed_event_id;

  await handleUpdate(db, async () => [e], botMessage(63, ANNOUNCEMENT)); // чужой: событие создано, витрина не тронута
  assert.equal(await claimed(901), null);
  await handleUpdate(db, async () => [e], botMessage(62, ANNOUNCEMENT));
  const mine = (await (await call(tma(62, 'Аня'), 'GET', '/events')).json()) as { event: { id: string } }[];
  assert.equal(await claimed(901), mine[0]!.event.id);
  assert.equal(await claimed(902), null, 'подтверждается одна запись');
});

test('RSVP: одно подтверждение гостю, сводка организатору, клики туда-сюда не спамят', async () => {
  const { event } = await newEvent(tma(70, 'Миша'), { max_capacity: 5 });
  const rsvp = async (id: number, approval_status: string) =>
    assert.equal((await call(tma(id, `G${id}`), 'POST', `/events/${event.id}/rsvp`, { approval_status })).status, 200);
  const labels = () => sent.map(([m, b]) => [m, b.chat_id, JSON.parse(b.public_data).l]);
  // Уведомления уходят после паузы; здесь она короткая, и тест ждёт, пока очередь опустеет.
  const delay = settings.notifyDelayMs;
  settings.notifyDelayMs = 150;
  const settle = () => new Promise((r) => setTimeout(r, 400));
  try {
    // Прокликал «пойду → думаю → не пойду» и ушёл: никому ничего не приходит.
    sent.length = 0;
    for (const status of ['approved', 'maybe', 'declined']) await rsvp(74, status);
    await settle();
    assert.deepEqual(labels(), []);

    // Трое записались почти одновременно, один сразу передумал: гостям — по подтверждению, организатору — одна сводка.
    for (const id of [71, 72, 75]) await rsvp(id, 'approved');
    await rsvp(72, 'declined');
    await rsvp(71, 'declined');
    await rsvp(71, 'approved');
    await settle();
    assert.deepEqual(labels().sort(), [['sendWidget', 70, 'Новые записи'], ['sendWidget', 71, 'Вы записаны'], ['sendWidget', 75, 'Вы записаны']]);
    const toHost = sent.find(([, b]) => b.chat_id === 70)![1];
    assert.equal(JSON.parse(toHost.public_data).t, 'G71 и G75 придут');
    assert.deepEqual(JSON.parse(toHost.public_data).m.at(-1), ['👥', 'Записано: 2 из 5']);
    assert.deepEqual(toHost.reply_markup.inline_keyboard[0][0], { text: 'Написать: G71', url: 'https://t.me/u71' });

    // Отписался и записался снова: гостю второе подтверждение за сутки не приходит, организатор узнаёт.
    sent.length = 0;
    await rsvp(71, 'declined');
    await rsvp(71, 'approved');
    await rsvp(72, 'maybe');
    await rsvp(70, 'approved'); // организатор сам себе гость — сводки себе не получает
    await settle();
    await settle(); // окно второй сводки вдвое длиннее
    assert.deepEqual(labels().sort(), [['sendWidget', 70, 'Вы записаны'], ['sendWidget', 70, 'Новая запись']]);
  } finally {
    settings.notifyDelayMs = delay;
  }

  // Telegram недоступен — запись всё равно проходит.
  const stub = bot.call;
  const error = console.error;
  console.error = () => {};
  bot.call = async () => { throw new Error('telegram is down'); };
  settings.notifyDelayMs = 0;
  try {
    const res = await call(tma(73, 'Нино'), 'POST', `/events/${event.id}/rsvp`, { approval_status: 'approved' });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as EventView).me?.approval_status, 'approved');
    await new Promise((r) => setTimeout(r, 100)); // даём уведомлениям упасть, пока console.error заглушён
  } finally {
    bot.call = stub;
    console.error = error;
    settings.notifyDelayMs = delay;
  }
});

test('сообщение боту: пересланный чужой анонс — собранное событие на витрине, не событие отправителя', async () => {
  const forward = (id: number, origin: object) => botMessage(id, ANNOUNCEMENT, { forward_origin: { date: 1794000000, ...origin } });
  const channel = { type: 'channel', chat: { id: -1001234567890, username: 'DanangEvent' }, message_id: 777 };
  const e = extracted({ title: 'Экстатик дэнс у моря', telegram_username: 'dj_kolya', price: null });
  // Пересланное ждёт одобрения и на витрине не видно — смотрим так, как его видит админка.
  const item = async (slug: string) => (await listCollectedForAdmin(db)).find((x) => x.id === slug)!;

  sent.length = 0;
  await handleUpdate(db, async () => [e], forward(64, channel));
  assert.equal((await app.request('/collected-events/danangevent-777-0')).status, 404, 'до одобрения страницы события нет');
  // Ключ и адрес — как у сборщика: когда он дойдёт до этой публикации, второй записи не появится.
  const added = await item('danangevent-777-0');
  assert.deepEqual([added.title, added.source_url, added.claimed_event_id], ['Экстатик дэнс у моря', 'https://t.me/DanangEvent/777', null]);
  assert.deepEqual(await (await call(tma(64, 'Аня'), 'GET', '/events')).json(), [], 'событие Ясвами не создано, лимит не тронут');
  assert.deepEqual(sent.map(([m, b]) => [m, b.chat_id, JSON.parse(b.public_data).l]), [['sendWidget', 64, 'Отправлено на проверку']]);
  assert.ok(sent[0]![1].reply_markup.inline_keyboard[0][0].url.endsWith('/e/danangevent-777-0'));

  // Тот же анонс от другого человека и из лички: запись дополняется, а не дублируется.
  const before = ((await (await app.request('/collected-events')).json()) as unknown[]).length;
  await handleUpdate(db, async () => [{ ...e, price: '200k' }], forward(65, { type: 'user', sender_user: { id: 99, username: 'dj_kolya' } }));
  assert.equal(((await (await app.request('/collected-events')).json()) as unknown[]).length, before);
  assert.equal((await item('danangevent-777-0')).price, '200k');

  // Переслано от человека, события ещё нет: источник — его профиль.
  await handleUpdate(db, async () => [extracted({ title: 'Нетворкинг фаундеров' })], forward(65, { type: 'user', sender_user: { id: 99, username: 'dj_kolya' } }));
  assert.equal((await item('bot65-1-0')).source_url, 'https://t.me/dj_kolya');

  // Контактом в пересланном анонсе указан сам отправитель — это его событие.
  sent.length = 0;
  await handleUpdate(db, async () => [extracted({ title: 'Баня по-чёрному', telegram_username: '@U66' })], forward(66, { type: 'channel', chat: { id: -1005, username: 'banya' }, message_id: 3 }));
  assert.equal(JSON.parse(sent[0]![1].public_data).l, 'Событие создано и подтверждено');
  assert.equal(((await (await call(tma(66, 'Аня'), 'GET', '/events')).json()) as unknown[]).length, 1);
});

test('заходы: пишутся с тем, кто позвал; организатор, свой и подделанный ref не считаются', async () => {
  const host = tma(901, 'Хост');
  const { event, ticket_types } = await newEvent(host);
  await call(tma(902, 'Друг'), 'GET', '/events'); // тот, кто зовёт, уже есть в базе
  const visit = (auth: string, body: object) => call(auth, 'POST', `/events/${event.id}/visit`, body);

  assert.equal((await visit(tma(903, 'Гость'), { ref: 902 })).status, 204);
  assert.equal((await visit(tma(903, 'Гость'), { ref: 903 })).status, 204); // сам себя
  assert.equal((await visit(tma(903, 'Гость'), { ref: 999_999 })).status, 204); // такого пользователя нет
  assert.equal((await visit(host, {})).status, 204); // организатор — не свой клиент
  assert.equal((await visit(tma(903, 'Гость'), { ref: 'x' })).status, 400);
  assert.equal((await call(tma(903, 'Гость'), 'POST', '/events/e_none/visit', {})).status, 404);

  // контакты организатора: гость попал по заходу, счётчик растёт с ответом «пойду»; у гостя контактов нет
  const contactsOf = async (auth: string) => ((await (await call(auth, 'GET', '/contacts')).json()) as { entries: Contact[] }).entries;
  assert.deepEqual((await contactsOf(host)).map((c) => [c.user_id, c.first_name, c.username, c.event_approved_count]), [[903, 'Гость', 'u903', 0]]);
  await call(tma(903, 'Гость'), 'POST', `/events/${event.id}/rsvp`, { approval_status: 'approved', event_ticket_type_id: ticket_types[0]!.id });
  await call(tma(904, 'Без захода'), 'POST', `/events/${event.id}/rsvp`, { approval_status: 'maybe' });
  assert.deepEqual((await contactsOf(host)).map((c) => [c.user_id, c.event_approved_count]).sort(), [[903, 1], [904, 0]]);
  assert.deepEqual(await contactsOf(tma(903, 'Гость')), []);

  const rows = await db.select().from(visits).where(eq(visits.event_id, event.id)).orderBy(asc(visits.created_at));
  assert.deepEqual(rows.map((r) => [r.user_id, r.referrer_id]), [[903, 902], [903, null], [903, null]]);
});

test('фото: аватар гостя и фото сообщества организатора хранятся в базе и отдаются с долгим кэшем', async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const realFetch = globalThis.fetch;
  const realCall = bot.call;
  const asked: string[] = [];
  globalThis.fetch = async (input) => (asked.push(String(input)), new Response(jpeg));
  // Аватар берётся через бота по id пользователя: у 9102 фото есть, у остальных нет.
  const sizes = [160, 320, 640].map((w) => ({ file_id: `f${w}`, file_unique_id: `u${w}`, width: w, height: w }));
  bot.token = 'T';
  bot.call = async (method, body) => {
    asked.push(method);
    if (method === 'getFile') return { ok: true, result: { file_path: `photos/${(body as { file_id: string }).file_id}.jpg` } };
    return { ok: true, result: { photos: (body as { user_id: number }).user_id === 9102 ? [sizes] : [] } };
  };
  try {
    const host = tma(9101, 'Вера');
    const { event } = await newEvent(host);
    const ticket = ((await (await call(host, 'GET', `/events/${event.id}`)).json()) as EventView).ticket_types[0]!.id;
    // Гость из мини-приложения и гость, написавший боту /start: путь один — upsertUser.
    await call(tma(9102, 'Гость9102'), 'POST', `/events/${event.id}/rsvp`, { approval_status: 'approved', event_ticket_type_id: ticket });
    await handleUpdate(db, undefined, { message: { message_id: 1, date: 1, chat: { id: 9103, type: 'private' }, from: { id: 9103, first_name: 'Гость9103' }, text: '/start' } });
    await call(tma(9103, 'Гость9103'), 'POST', `/events/${event.id}/rsvp`, { approval_status: 'approved', event_ticket_type_id: ticket });
    for (const id of [9101, 9102, 9103, 9102]) await saveUserPhoto(db, id); // дождаться фона; повтор не качает заново
    assert.deepEqual(asked.filter((a) => a !== 'sendMessage'), [
      'getUserProfilePhotos', 'getUserProfilePhotos', 'getFile', 'https://api.telegram.org/file/botT/photos/f320.jpg', 'getUserProfilePhotos',
    ], 'по запросу на человека; качаем размер 320 и только у кого фото есть');

    const view = (await (await call(host, 'GET', `/events/${event.id}`)).json()) as EventView;
    const [withPhoto, without] = view.guests;
    assert.equal(without!.user_photo_url, null);
    assert.match(withPhoto!.user_photo_url!, /\/api\/photos\/[0-9a-f-]{36}$/);

    // Отдаётся без входа: <img> заголовок не пришлёт.
    const res = await app.request(withPhoto!.user_photo_url!.replace(/^.*\/api/, ''));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.match(res.headers.get('cache-control')!, /immutable/);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), jpeg);
    assert.equal((await app.request('/photos/nope')).status, 404);
    assert.equal((await app.request('/photos/00000000-0000-4000-8000-000000000000')).status, 404);
  } finally {
    globalThis.fetch = realFetch;
    bot.call = realCall;
    bot.token = '';
  }

  // Фото сообщества кладёт сборщик; API отдаёт не больше шести, новые сверху.
  const [h] = await db.insert(hosts).values({ telegram_id: 9104, username: 'photo_host', name: 'Студия' }).returning();
  await db.insert(collectedEvents).values({
    external_id: 'telegram:photochan/1#0', channel: 'photochan', status: 'published' as const, announcement: { url: 'https://t.me/photochan/1' }, signup_url: 'https://t.me/photochan/1',
    event: { title: 'Йога', starts_at: '2030-01-01T10:00:00+07:00' } as CollectedEvent, starts_at: new Date('2030-01-01T03:00:00Z'), telegram_username: 'photo_host',
  });
  const item = async () => (await (await app.request('/collected-events/photochan-1-0')).json()) as CollectedEventItem;
  assert.deepEqual((await item()).hosts![0]!.photos, [], 'без фото блок организатора прежний');
  for (let i = 1; i <= 7; i++) {
    await db.insert(photos).values({ host_id: h!.id, source: `telegram:photochan/${i}`, data: Buffer.from([0xff, 0xd8, i]), created_at: new Date(2026, 0, i) });
  }
  const shown = (await item()).hosts![0]!.photos;
  assert.equal(shown.length, 6);
  assert.deepEqual(shown.map((p) => p.source_url).slice(0, 2), ['https://t.me/photochan/7', 'https://t.me/photochan/6'], 'клик по фото ведёт на публикацию');
  assert.deepEqual(Buffer.from(await (await app.request(shown[0]!.url.replace(/^.*\/api/, ''))).arrayBuffer()), Buffer.from([0xff, 0xd8, 7]));
});

test('переписка: бот пишет всё в базу, админ отвечает и берёт диалог на себя', async () => {
  await db.execute(sql`truncate conversations cascade`);
  settings.adminIds = [70];
  const admin = tma(70, 'Админ');
  const never = async () => assert.fail('ИИ вызывать не нужно');
  const inbox = async () => (await (await call(admin, 'GET', '/admin/inbox')).json()) as InboxFeed;
  const write = async (text: string) => {
    sent.length = 0;
    await handleUpdate(db, never, botMessage(71, text));
    return sent.filter(([method, b]) => method === 'sendMessage' && b.chat_id === 71).map(([, b]) => b.text); // без оповещений нам самим
  };

  assert.equal((await call(tma(71, 'Аня'), 'GET', '/admin/inbox')).status, 403, 'не админ');

  // /start — справка без пометки; вопрос, на который бот ответил отказом, ждёт нас.
  assert.deepEqual(await write('/start'), [REPLIES.help]);
  assert.equal((await inbox()).conversations[0]!.attention, null);
  assert.deepEqual(await write('Как записаться на покер?'), [REPLIES.no_date]);
  let feed = await inbox();
  assert.equal(feed.me, 70);
  assert.deepEqual(feed.conversations.map((c) => [c.peer_id, c.peer_name, c.mode, c.attention]), [[71, 'Аня', 'agent', 'Бот не создал событие']]);
  assert.deepEqual([feed.conversations[0]!.kind, feed.conversations[0]!.stage], ['guest', 'bot']);
  assert.deepEqual(feed.messages.map((m) => [m.direction, m.author, m.text, m.status]), [
    ['out', 'bot', REPLIES.no_date, 'sent'],
    ['in', 'user', 'Как записаться на покер?', 'received'],
    ['out', 'bot', REPLIES.help, 'sent'],
    ['in', 'user', '/start', 'received'],
  ]);

  // Отвечаем сами: сообщение уходит через бота, диалог наш, пометка снята.
  const id = feed.conversations[0]!.id;
  sent.length = 0;
  assert.equal((await call(admin, 'POST', `/admin/conversations/${id}/messages`, { text: 'Привет! Сейчас помогу.' })).status, 204);
  assert.deepEqual(sent.map(([m, b]) => [m, b.chat_id, b.text]), [['sendMessage', 71, 'Привет! Сейчас помогу.']]);
  feed = await inbox();
  assert.deepEqual([feed.conversations[0]!.mode, feed.conversations[0]!.attention], ['human', null]);
  assert.deepEqual([feed.messages[0]!.author, feed.messages[0]!.status], ['admin:70', 'sent']);

  // Пока диалог наш, бот молчит, а новое сообщение снова ждёт нас.
  assert.deepEqual(await write('Спасибо, жду'), []);
  assert.deepEqual(sent.map(([, b]) => [b.chat_id, b.text.split('\n')[0]]), [[70, 'Аня (@u71) ждёт человека: Ответил вам']], 'нам пришло оповещение');
  assert.equal((await inbox()).conversations[0]!.attention, 'Ответил вам');
  const thread = (await (await call(admin, 'GET', `/admin/conversations/${id}/messages`)).json()) as Message[];
  assert.deepEqual(thread.map((m) => m.text).slice(-2), ['Привет! Сейчас помогу.', 'Спасибо, жду']);

  // Вернули боту — он снова отвечает.
  const back = await call(admin, 'PATCH', `/admin/conversations/${id}`, { mode: 'agent', attention: null });
  assert.deepEqual([((await back.json()) as Conversation).mode, back.status], ['agent', 200]);
  assert.deepEqual(await write('А сегодня что-нибудь есть?'), [REPLIES.no_date]);

  // Те же операции через MCP — так работает Hermes. Не админу инструменты переписки не видны.
  const mcp = async (auth: string, method: string, params?: object) =>
    ((await (await call(auth, 'POST', '/mcp', { jsonrpc: '2.0', id: 1, method, params })).json()) as { result: any }).result;
  const toolNames = async (auth: string) => (await mcp(auth, 'tools/list')).tools.map((t: { name: string }) => t.name);
  assert.ok(!(await toolNames(tma(71, 'Аня'))).includes('admin_messages_send'));
  assert.ok((await toolNames(admin)).includes('admin_messages_send'));
  const tool = async (name: string, args: object) => JSON.parse((await mcp(admin, 'tools/call', { name, arguments: args })).content[0].text);
  assert.deepEqual((await tool('admin_conversations_list', { waiting_only: true })).map((c: Conversation) => c.id), [id]);
  sent.length = 0;
  await tool('admin_messages_send', { conversation_id: id, text: 'Сегодня в 19:00 покер, записать?' });
  assert.deepEqual(sent.map(([, b]) => b.text), ['Сегодня в 19:00 покер, записать?']);
  // Обложки: иллюстратор видит события без проверки, оставляет фото анонса; чужой адрес картинки не скачиваем.
  await db.delete(collectedEvents);
  const starts_at = new Date(Date.now() + 86_400_000);
  await db.insert(collectedEvents).values({
    external_id: 'telegram:danangevent/5#0', channel: 'danangevent', status: 'published' as const, starts_at, signup_url: 'https://t.me/x', announcement: { url: 'https://t.me/danangevent/5' },
    event: { title: 'Баня', description: 'Парим', starts_at: starts_at.toISOString(), ends_at: null, place: null, address: null, price: null, tags: ['баня'], telegram_username: 'igor', whatsapp_phone: null, url: null, topic: 'баня' },
  });
  const [photo] = await db.insert(photos).values({ collected_external_id: 'telegram:danangevent/5#0', source: 'telegram:danangevent/5', data: Buffer.from([0xff, 0xd8, 1]) }).returning();
  const cover = `${settings.publicUrl}/api/photos/${photo!.id}`;
  assert.deepEqual(await tool('admin_covers_list', {}), [{ id: 'danangevent-5-0', title: 'Баня', description: 'Парим', topic: 'баня', tags: ['баня'], place: null, photo_url: cover }]);
  assert.deepEqual(await tool('admin_covers_set', { id: 'danangevent-5-0', image_url: 'https://evil.example/x.png' }), { error: 'bad_image_url' });
  assert.deepEqual(await tool('admin_covers_set', { id: 'danangevent-5-0' }), { cover_url: cover });
  assert.deepEqual(await tool('admin_covers_list', {}), []);
  assert.equal(((await (await app.request('/collected-events')).json()) as CollectedEventItem[])[0]!.cover_url, cover);
  assert.ok(!(await toolNames(tma(71, 'Аня'))).includes('admin_covers_set'));

  // Ролик: заказ уходит роли illustrator вместе с фото анонса, ссылка сохраняется; второй раз и сверх лимита — отказ.
  assert.deepEqual(await tool('admin_videos_request', { id: 'danangevent-5-0' }), { error: 'illustrator_off' });
  settings.illustratorUrl = 'http://illustrator.test';
  const draw = illustrator.ask;
  let task = '';
  illustrator.ask = async (t) => ((task = t), { cover_url: null, video_url: 'https://files-cdn.x.ai/abc/file_1.mp4' });
  assert.deepEqual(await tool('admin_videos_request', { id: 'danangevent-5-0' }), { started: true });
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(task.includes('"title":"Баня"') && task.includes(cover), 'роль получает данные события и фото анонса');
  assert.equal(((await (await app.request('/collected-events/danangevent-5-0')).json()) as CollectedEventItem).video_url, 'https://files-cdn.x.ai/abc/file_1.mp4');
  assert.deepEqual(await tool('admin_videos_request', { id: 'danangevent-5-0' }), { error: 'video_exists' });
  settings.illustratorDailyLimit = 1;
  await db.insert(collectedEvents).values({
    external_id: 'telegram:danangevent/6#0', channel: 'danangevent', status: 'published' as const, starts_at, signup_url: 'https://t.me/x', announcement: { url: 'https://t.me/danangevent/6' },
    event: { title: 'Йога', description: '', starts_at: starts_at.toISOString(), ends_at: null, place: null, address: null, price: null, tags: [], telegram_username: 'anna', whatsapp_phone: null, url: null },
  });
  assert.deepEqual(await tool('admin_videos_request', { id: 'danangevent-6-0' }), { error: 'video_limit' });
  assert.deepEqual(parseIllustration('cover: https://files-cdn.x.ai/a/b_1.png\nvideo: https://files-cdn.x.ai/c/d_2.mp4'),
    { cover_url: 'https://files-cdn.x.ai/a/b_1.png', video_url: 'https://files-cdn.x.ai/c/d_2.mp4' });
  assert.deepEqual(parseIllustration('cover: https://evil.example/x.png\n[[не получилось: нет фото]]'), { cover_url: null, video_url: null }, 'чужие адреса не берём');
  // Модерация: новое событие ждёт решения и нигде не видно; одобренное выходит в ленту после обработки.
  const moderated = { ...{ channel: 'danangevent', starts_at, signup_url: 'https://t.me/x', announcement: { url: 'https://t.me/danangevent/7' } },
    external_id: 'telegram:danangevent/7#0',
    event: { title: 'Чай', description: '', starts_at: starts_at.toISOString(), ends_at: null, place: null, address: null, price: null, tags: [], telegram_username: 'tea', whatsapp_phone: null, url: null } };
  await db.insert(collectedEvents).values(moderated);
  const inFeed = async () => ((await (await app.request('/collected-events')).json()) as CollectedEventItem[]).some((e) => e.id === 'danangevent-7-0');
  const adminEvents = async () => (await (await call(admin, 'GET', '/admin/collected-events')).json()) as { id: string; status: string }[];
  assert.equal((await adminEvents())[0]!.id, 'danangevent-7-0', 'ждущие решения — сверху');
  assert.deepEqual([await inFeed(), (await app.request('/collected-events/danangevent-7-0')).status], [false, 404]);
  assert.deepEqual(await tool('admin_videos_request', { id: 'danangevent-7-0' }), { error: 'not_approved' });
  assert.equal((await call(tma(71, 'Аня'), 'GET', '/admin/collected-events')).status, 403);
  // Правка без решения: событие остаётся ждать, поля и колонки для выборок меняются, контакт — как у сборщика.
  assert.equal((await call(admin, 'PATCH', '/admin/collected-events/danangevent-7-0', { title: '' })).status, 400);
  const later = new Date(starts_at.getTime() + 3600_000).toISOString().replace('Z', '+00:00');
  const edited = (await (await call(admin, 'PATCH', '/admin/collected-events/danangevent-7-0', { title: 'Чайная церемония', place: null, starts_at: later, telegram_username: '@TeaMaster' })).json()) as AdminCollectedEvent;
  assert.deepEqual([edited.status, edited.title, edited.telegram_username, edited.description, edited.starts_at], ['pending', 'Чайная церемония', 'teamaster', '', later]);
  const [stored] = await db.select().from(collectedEvents).where(eq(collectedEvents.external_id, 'telegram:danangevent/7#0'));
  assert.deepEqual([stored!.telegram_username, stored!.starts_at.toISOString()], ['teamaster', new Date(later).toISOString()]);
  // Лимит выбран — одобренное выходит как есть, а не ждёт сутки. Правка и решение — одним запросом.
  assert.equal(((await (await call(admin, 'PATCH', '/admin/collected-events/danangevent-7-0', { status: 'approved', price: '200 000 ₫' })).json()) as AdminCollectedEvent).status, 'published');
  assert.equal(await inFeed(), true);
  assert.equal(((await (await app.request('/collected-events/danangevent-7-0')).json()) as CollectedEventItem).price, '200 000 ₫');
  // Перерисовать: обложка удалена, обработка сброшена; очередь возьмёт событие только через 20 минут.
  await db.update(collectedEvents).set({ video_url: 'https://files-cdn.x.ai/a/old.mp4', video_tries: 1 }).where(eq(collectedEvents.external_id, 'telegram:danangevent/7#0'));
  await db.insert(photos).values({ collected_external_id: 'telegram:danangevent/7#0', source: 'x', data: Buffer.from([0xff, 0xd8]) });
  assert.equal((await call(admin, 'POST', '/admin/collected-events/danangevent-7-0/redo')).status, 204);
  const redone = (await adminEvents()).find((e) => e.id === 'danangevent-7-0') as unknown as CollectedEventItem;
  assert.deepEqual([redone.video_url, redone.cover_url], [null, null]);
  assert.equal(await requestNextVideo(db), null, 'до возврата фото анонса очередь его не берёт');
  // Снять с публикации и удалить.
  assert.equal(((await tool('admin_collected_events_update', { id: 'danangevent-7-0', status: 'rejected' })) as AdminCollectedEvent).status, 'rejected');
  assert.equal(await inFeed(), false);
  assert.equal((await call(admin, 'DELETE', '/admin/collected-events/danangevent-7-0')).status, 204);
  assert.equal((await adminEvents()).some((e) => e.id === 'danangevent-7-0'), false);

  // Автообход: берёт ближайшее событие без ролика; лимит выбран — тихо пропускает.
  assert.equal(await requestNextVideo(db), null, 'лимит на сегодня выбран');
  settings.illustratorDailyLimit = 5;
  assert.equal(await requestNextVideo(db), 'danangevent-6-0');
  assert.equal(await requestNextVideo(db), null, 'событий без ролика не осталось');
  // Заказ, оборванный перезапуском API: через 20 минут без ролика повторяем, но только один раз.
  await new Promise((r) => setTimeout(r, 50));
  await db.update(collectedEvents).set({ video_url: null, video_at: new Date(Date.now() - 21 * 60_000) }).where(eq(collectedEvents.external_id, 'telegram:danangevent/6#0'));
  assert.equal(await requestNextVideo(db), 'danangevent-6-0', 'потерянный заказ повторяется');
  await new Promise((r) => setTimeout(r, 50));
  await db.update(collectedEvents).set({ video_url: null, video_at: new Date(Date.now() - 21 * 60_000) }).where(eq(collectedEvents.external_id, 'telegram:danangevent/6#0'));
  assert.equal(await requestNextVideo(db), null, 'третьей попытки нет');
  await new Promise((r) => setTimeout(r, 50));
  illustrator.ask = draw;
  settings.illustratorUrl = '';

  const read = await tool('admin_conversations_get', { conversation_id: id });
  assert.deepEqual([read.conversation.mode, read.messages.at(-1).author], ['human', 'agent']);
  assert.deepEqual(await tool('admin_conversations_list', { waiting_only: true }), []);

  // Роль поддержки: на вопрос без даты отвечает она, а не отказ бота; переписку получает целиком.
  await call(admin, 'PATCH', `/admin/conversations/${id}`, { mode: 'agent', attention: null });
  settings.supportUrl = 'http://support.test';
  const ask = support.ask;
  let asked: Parameters<typeof support.ask>[0] = [];
  support.ask = async (history) => ((asked = history), { text: 'Откройте событие и нажмите «Пойду».', human: null });
  assert.deepEqual(await write('Как отменить запись?'), ['Откройте событие и нажмите «Пойду».']);
  assert.deepEqual(asked.at(-1), { role: 'user', content: 'Как отменить запись?' });
  assert.match(asked[0]!.content, /^Данные сервиса о собеседнике \(Аня\)[\s\S]*События, которые он создал:\n- /, 'роль получает события и записи самого человека');
  assert.ok(asked.some((t) => t.role === 'assistant' && t.content === 'Сегодня в 19:00 покер, записать?'), 'в истории есть прошлые ответы');
  feed = await inbox();
  assert.deepEqual([feed.messages[0]!.author, feed.conversations[0]!.attention], ['agent:support', null]);
  // С билетом из переписки роль работает с событиями самого человека; без верного билета — отказ.
  settings.supportKey = 'support-key-for-tests';
  const ticket = /Билет[^:]*: (\S+)/.exec((await (async () => { await write('Покажи мои события'); return asked[0]!.content; })()))![1]!;
  assert.equal(verifyTicket(ticket), 71);
  assert.equal(verifyTicket(ticket.replace(/^71/, '70')), null, 'чужой номер под той же подписью');
  assert.equal(verifyTicket(ticket, Date.now() + 31 * 60_000), null, 'просрочен');
  const made = await tool('person_events_create', { ticket, kind: 'o', name: 'Йога на пляже', start_at: '2027-01-10T07:00:00+07:00', timezone: 'Asia/Ho_Chi_Minh' });
  assert.equal(made.is_host, true);
  assert.ok(made.url.includes(made.event.id));
  assert.ok((await tool('person_events_list', { ticket })).some((e: any) => e.event.name === 'Йога на пляже' && e.is_host), 'в списке событий человека');
  assert.equal((await tool('person_events_update', { ticket, event_id: made.event.id, name: 'Йога на рассвете' })).event.name, 'Йога на рассвете');
  assert.deepEqual(await tool('person_events_list', { ticket: 'подделка' }), { error: 'bad_ticket' });
  const view = (await (await call(tma(71, 'Аня'), 'GET', `/events/${made.event.id}`)).json()) as EventView;
  assert.deepEqual([view.event.name, view.is_host], ['Йога на рассвете', true], 'событие принадлежит человеку, а не владельцу токена');
  settings.supportKey = '';

  // Роль зовёт человека: пометка в админке и сообщение нам; оповещение в переписку не попадает.
  support.ask = async () => parseSupportReply('Передал команде, вам ответят.\n[[человек: жалоба на организатора]]');
  sent.length = 0;
  await handleUpdate(db, never, botMessage(71, 'Организатор взял деньги и пропал'));
  assert.deepEqual(sent.filter(([m]) => m === 'sendMessage').map(([, b]) => [b.chat_id, b.text.split('\n')[0]]), [
    [71, 'Передал команде, вам ответят.'],
    [70, 'Аня (@u71) ждёт человека: жалоба на организатора'],
  ]);
  feed = await inbox();
  assert.deepEqual([feed.conversations.length, feed.conversations[0]!.attention], [1, 'жалоба на организатора']);
  // Дата в тексте есть, а события ИИ не нашёл — это тоже вопрос роли, а не отказ.
  support.ask = async () => ({ text: 'В пятницу покер в 19:00.', human: null });
  sent.length = 0;
  await handleUpdate(db, async () => [], botMessage(71, 'Что будет в пятницу 20 ноября в 19:00?'));
  assert.deepEqual(sent.filter(([m]) => m === 'sendMessage').map(([, b]) => b.text), ['В пятницу покер в 19:00.']);
  // Роль открыта только списку пользователей — остальным прежний отказ бота, роль даже не спрашиваем.
  settings.supportUserIds = [70];
  support.ask = async () => assert.fail('роль не для этого пользователя');
  assert.deepEqual(await write('А мне ответят?'), [REPLIES.no_date]);
  settings.supportUserIds = [];
  // Роль недоступна — прежний отказ бота.
  support.ask = async () => null;
  assert.deepEqual(await write('Алло?'), [REPLIES.no_date]);
  support.ask = ask;
  settings.supportUrl = '';
  assert.deepEqual(parseSupportReply('Привет!\n[[человек:]]'), { text: 'Привет!', human: 'Просит человека' });

  // Telegram не принял сообщение: оно остаётся в ленте как недоставленное, админка получает ошибку.
  const ok = bot.call;
  bot.call = async () => ({ ok: false, error_code: 403, description: 'bot was blocked by the user' });
  assert.equal((await call(admin, 'POST', `/admin/conversations/${id}/messages`, { text: 'Вы тут?' })).status, 409);
  bot.call = ok;
  assert.deepEqual([(await inbox()).messages[0]!.text, (await inbox()).messages[0]!.status], ['Вы тут?', 'failed']);
});

test('аккаунты Telegram: вход по шагам из админки, сообщения с аккаунта, ответ через очередь', async () => {
  await db.execute(sql`truncate conversations, tg_accounts cascade`);
  settings.adminIds = [70];
  settings.collectorSecret = 'collector-secret';
  const admin = tma(70, 'Админ');
  const inbox = async () => (await (await call(admin, 'GET', '/admin/inbox')).json()) as InboxFeed;

  // Новый аккаунт ждёт, пока сборщик запросит код; код раньше времени не принимается.
  assert.equal((await call(tma(71, 'Аня'), 'POST', '/admin/accounts', { label: 'Аня', phone: '+84900000001' })).status, 403);
  assert.equal((await call(admin, 'POST', '/admin/accounts', { label: 'Аня', phone: '8-900' })).status, 400, 'номер не в международном формате');
  const created = await call(admin, 'POST', '/admin/accounts', { label: 'Аня', phone: '+84900000001' });
  const account = (await created.json()) as TgAccount;
  assert.deepEqual([created.status, account.status], [201, 'login_requested']);
  assert.equal((await call(admin, 'POST', '/admin/accounts', { label: 'Дубль', phone: '+84900000001' })).status, 409);
  assert.equal((await call(admin, 'POST', `/admin/accounts/${account.id}/login`, { secret: '12345' })).status, 409);
  // Сборщик запросил код — админ вводит его; наружу ни код, ни сессия не отдаются.
  await db.update(tgAccounts).set({ status: 'login_code', session: 'sealed' }).where(eq(tgAccounts.id, account.id));
  assert.equal((await call(admin, 'POST', `/admin/accounts/${account.id}/login`, { secret: '12345' })).status, 204);
  const [row] = await db.select().from(tgAccounts);
  assert.deepEqual(row!.login, { secret: '12345' });
  assert.deepEqual(Object.keys((await inbox()).accounts[0]!).sort(), ['created_at', 'id', 'label', 'last_error', 'phone', 'status']);

  // Сборщик сообщает о личном сообщении на аккаунте: без секрета — отказ.
  const report = (body: object, secret?: string) =>
    app.request('/internal/account-message', { method: 'POST', headers: { 'content-type': 'application/json', ...(secret ? { 'x-collector-secret': secret } : {}) }, body: JSON.stringify(body) });
  const incoming = { account_id: account.id, peer: { id: 555, name: 'Тим', username: 'tim_poker' }, direction: 'in', text: 'А что это за сервис?' };
  assert.equal((await report(incoming)).status, 403);
  assert.equal((await report(incoming, 'wrong-secret-0000')).status, 403);
  sent.length = 0;
  assert.equal((await report(incoming, 'collector-secret')).status, 204);
  let feed = await inbox();
  assert.deepEqual(feed.conversations.map((c) => [c.channel, c.account_id, c.peer_name, c.attention]), [['account', account.id, 'Тим', 'Написал на аккаунт']]);
  assert.deepEqual(sent.map(([, b]) => [b.chat_id, b.text.split('\n')[0]]), [[70, 'Тим (@tim_poker) ждёт человека: Написал на аккаунт']]);

  // Ответ из админки не идёт через бота: ложится в очередь, её заберёт сборщик.
  const id = feed.conversations[0]!.id;
  sent.length = 0;
  assert.equal((await call(admin, 'POST', `/admin/conversations/${id}/messages`, { text: 'Каталог событий Дананга.' })).status, 204);
  assert.deepEqual(sent, []);
  feed = await inbox();
  assert.deepEqual([feed.messages[0]!.status, feed.messages[0]!.author, feed.conversations[0]!.mode, feed.conversations[0]!.attention], ['queued', 'admin:70', 'human', null]);

  // Ответили прямо из Telegram — сообщение в ленте, диалог ведём мы.
  await call(admin, 'PATCH', `/admin/conversations/${id}`, { mode: 'agent' });
  assert.equal((await report({ ...incoming, direction: 'out', text: 'Пишу с телефона' }, 'collector-secret')).status, 204);
  feed = await inbox();
  assert.deepEqual([feed.messages[0]!.text, feed.messages[0]!.author, feed.conversations[0]!.mode], ['Пишу с телефона', 'admin', 'human']);

  // Аккаунт удалили: диалог остался, но ответить не с чего.
  assert.equal((await call(admin, 'DELETE', `/admin/accounts/${account.id}`)).status, 204);
  assert.equal((await call(admin, 'POST', `/admin/conversations/${id}/messages`, { text: 'Вы тут?' })).status, 409);
  settings.collectorSecret = '';
});

test('отзывы: запрос после события, оценка кнопкой, текст ответом, сводка организатору', async () => {
  const { event } = await newEvent(tma(80, 'Миша'));
  for (const id of [80, 81, 82]) await call(tma(id, `G${id}`), 'POST', `/events/${event.id}/rsvp`, { approval_status: 'approved' });
  await call(tma(84, 'G84'), 'POST', `/events/${event.id}/rsvp`, { approval_status: 'maybe' });
  await new Promise((r) => setTimeout(r, 100)); // уведомления о записи уходят с паузой — пусть не мешают
  const labels = () => sent.filter(([m]) => m === 'sendWidget').map(([, b]) => [b.chat_id, JSON.parse(b.public_data).l]).sort();
  const press = (id: number, data: string) => handleUpdate(db, undefined, { update_id: 1, callback_query: { id: 'q', from: { id, first_name: `G${id}` }, data } });

  // Событие ещё не прошло — никого не спрашиваем.
  sent.length = 0;
  await requestFeedback(db);
  assert.deepEqual(labels(), []);

  // Закончилось час назад: спрашиваем записанных гостей, один раз; организатора и «думающих» — нет.
  await db.update(eventsTable).set({ start_at: new Date(Date.now() - 4 * 3600e3), end_at: new Date(Date.now() - 3600e3) }).where(eq(eventsTable.id, event.id));
  await requestFeedback(db);
  await requestFeedback(db);
  assert.deepEqual(labels(), [[81, 'Как всё прошло?'], [82, 'Как всё прошло?']]);

  // Оценка: ответ на нажатие и одна просьба написать пару слов; повторное нажатие меняет оценку без новых сообщений.
  sent.length = 0;
  await press(81, `fb:${event.id}:4`);
  await press(81, `fb:${event.id}:5`);
  assert.deepEqual(sent.map(([m]) => m), ['answerCallbackQuery', 'sendMessage', 'answerCallbackQuery']);
  assert.equal(sent[2]![1].text, 'Спасибо! Ваша оценка: ★★★★★');
  const prompt = sent[1]![1];
  assert.deepEqual([prompt.chat_id, prompt.reply_markup.force_reply], [81, true]);
  const [row] = await db.select().from(eventFeedback).where(eq(eventFeedback.user_id, 81));
  assert.equal(row!.rating, 5);

  // Чужой и несуществующий запрос ничего не сохраняют.
  sent.length = 0;
  await press(83, `fb:${event.id}:1`);
  assert.equal(sent[0]![1].text, 'Этот запрос уже не действует');
  assert.equal((await db.select().from(eventFeedback).where(eq(eventFeedback.user_id, 83))).length, 0);

  // Текст — ответом на просьбу бота: это отзыв, а не анонс и не вопрос.
  sent.length = 0;
  await handleUpdate(db, async () => assert.fail('ИИ вызывать не нужно'), botMessage(81, 'Было здорово, в субботу приду ещё', { reply_to_message: { message_id: row!.prompt_message_id } }));
  assert.deepEqual(sent.map(([m, b]) => [m, b.text]), [['sendMessage', 'Спасибо! Отзыв сохранён, организатор его увидит.']]);

  // Сводка организатору: одна на событие, повторно не уходит; новая оценка — новая сводка.
  const settle = settings.feedbackSettleMs;
  try {
    sent.length = 0;
    await digestFeedback(db);
    assert.deepEqual(labels(), [], 'отзыв только что изменён — ждём');
    settings.feedbackSettleMs = 0;
    await digestFeedback(db);
    await digestFeedback(db);
    assert.deepEqual(labels(), [[80, 'Новый отзыв']]);
    assert.deepEqual(JSON.parse(sent[0]![1].public_data).m, [['⭐', '5,0 из 5 · оценок: 1'], ['💬', 'Аня: ★★★★★ Было здорово, в субботу приду ещё']]);
    sent.length = 0;
    await press(82, `fb:${event.id}:3`);
    await digestFeedback(db);
    assert.deepEqual(JSON.parse(sent.find(([m]) => m === 'sendWidget')![1].public_data).m, [['⭐', '4,0 из 5 · оценок: 2'], ['💬', 'G82: ★★★☆☆']]);
  } finally {
    settings.feedbackSettleMs = settle;
  }

  // На странице события: средняя оценка — всем, сами отзывы — организатору.
  const feedback = async (id: number) => ((await (await call(tma(id, `G${id}`), 'GET', `/events/${event.id}`)).json()) as EventView).feedback;
  assert.deepEqual(await feedback(80), {
    count: 2, average: 4,
    items: [{ user_first_name: 'Аня', rating: 5, comment: 'Было здорово, в субботу приду ещё' }, { user_first_name: 'G82', rating: 3, comment: null }],
  });
  assert.deepEqual(await feedback(82), { count: 2, average: 4, items: [] });
});

test('охотник: вопрос из чата становится черновиком, который отправляет человек', async () => {
  await db.execute(sql`truncate conversations, tg_accounts cascade`);
  settings.adminIds = [70];
  settings.collectorSecret = 'collector-secret';
  settings.hunterUrl = 'http://hunter.test';
  const admin = tma(70, 'Админ');
  const inbox = async () => (await (await call(admin, 'GET', '/admin/inbox')).json()) as InboxFeed;
  const lead = { chat: 'danang_chat', message_id: 3, url: 'https://t.me/danang_chat/3', author: { id: 555, name: 'Даша', username: 'dasha_k' }, text: 'Куда сегодня сходить потанцевать?', context: ['Всем привет'] };
  const ask = hunter.ask;
  let asked = '';
  hunter.ask = async (question) => ((asked = question), 'Сегодня в 19:00 бачата с нуля:\nhttps://yaswami.com/e/x');

  // Аккаунта ещё нет: черновик всё равно появляется, но отправить его не с чего.
  await recordLead(db, { ...lead, author: { id: 556, name: 'Никита', username: null } });
  const orphan = (await inbox()).messages.find((m) => m.status === 'draft')!;
  assert.equal((await inbox()).conversations[0]!.account_id, null);
  assert.equal((await call(admin, 'POST', `/admin/messages/${orphan.id}/send`, {})).status, 409);
  const [account] = await db.insert(tgAccounts).values({ label: 'Аня', phone: '+84900000009', status: 'active' }).returning();
  // Аккаунт подключили — тот же черновик уходит с него.
  assert.equal((await call(admin, 'POST', `/admin/messages/${orphan.id}/send`, {})).status, 204);
  assert.equal((await inbox()).conversations[0]!.account_id, account!.id);
  await db.execute(sql`truncate conversations cascade`);

  // Пока роль проверяется, реагируем только на вопросы людей из списка.
  settings.hunterUserIds = [777];
  await recordLead(db, lead);
  assert.equal((await inbox()).conversations.length, 0);
  settings.hunterUserIds = [555];
  sent.length = 0;
  await recordLead(db, lead);
  assert.match(asked, /Чат: danang_chat[\s\S]*- Всем привет[\s\S]*Вопрос \(Даша\):\nКуда сегодня сходить потанцевать\?/);
  let feed = await inbox();
  assert.deepEqual(feed.conversations.map((c) => [c.channel, c.account_id, c.peer_id, c.attention]), [['account', account!.id, 555, 'Черновик ответа в чат']]);
  const draft = feed.messages.find((m) => m.status === 'draft')!;
  assert.deepEqual([draft.author, draft.meta], ['agent:hunter', { reason: 'Вопрос в чате danang_chat', source_url: lead.url, reply_to: { chat: 'danang_chat', message_id: 3 } }]);
  assert.deepEqual(sent.map(([, b]) => b.chat_id), [70], 'нам пришло оповещение, человеку — ничего');

  // Второй вопрос того же человека, пока черновик ждёт, — не дублируем.
  await recordLead(db, { ...lead, message_id: 4 });
  assert.equal((await inbox()).messages.filter((m) => m.status === 'draft').length, 1);

  // Отправляем с правкой: черновик встаёт в очередь с нашим текстом и адресом ответа в чате.
  assert.equal((await call(tma(71, 'Аня'), 'POST', `/admin/messages/${draft.id}/send`, {})).status, 403);
  assert.equal((await call(admin, 'POST', `/admin/messages/${draft.id}/send`, { text: 'Сегодня бачата в 19:00' })).status, 204);
  feed = await inbox();
  assert.deepEqual([feed.messages[0]!.status, feed.messages[0]!.text, feed.messages[0]!.meta?.reply_to?.message_id, feed.conversations[0]!.attention], ['queued', 'Сегодня бачата в 19:00', 3, null]);
  assert.equal((await call(admin, 'POST', `/admin/messages/${draft.id}/send`, {})).status, 409, 'второй раз не отправить');

  // Через неделю тому же человеку можно ответить снова; отклонённый черновик пропадает.
  await db.execute(sql`update messages set created_at = now() - interval '8 days'`);
  await recordLead(db, { ...lead, message_id: 5 });
  const second = (await inbox()).messages.find((m) => m.status === 'draft')!;
  assert.equal((await call(admin, 'DELETE', `/admin/messages/${second.id}`)).status, 204);
  feed = await inbox();
  assert.deepEqual([feed.messages.some((m) => m.status === 'draft'), feed.conversations[0]!.attention], [false, null]);

  // Роль решила не отвечать — ничего не создаём.
  await db.execute(sql`truncate conversations cascade`);
  hunter.ask = async () => null;
  await recordLead(db, lead);
  assert.equal((await inbox()).conversations.length, 0);

  hunter.ask = ask;
  Object.assign(settings, { hunterUrl: '', hunterUserIds: [], collectorSecret: '' });
});

test('организаторы: запись на событие становится черновиком сообщения, ответ организатора — черновиком ответа', async () => {
  await db.execute(sql`truncate conversations, tg_accounts cascade`);
  await db.execute(sql`delete from collected_events where channel = 'hostchan'`);
  await db.execute(sql`delete from hosts where username = 'marina_yoga'`);
  settings.adminIds = [70];
  settings.collectorSecret = 'collector-secret';
  const admin = tma(70, 'Админ');
  const inbox = async () => (await (await call(admin, 'GET', '/admin/inbox')).json()) as InboxFeed;
  const starts_at = new Date(Date.now() + 3 * 86_400_000);
  const external_id = 'telegram:hostchan/7#0';
  await db.insert(collectedEvents).values({
    external_id, channel: 'hostchan', status: 'published' as const, starts_at, signup_url: '', announcement: { url: 'https://t.me/hostchan/7' },
    event: { title: 'Йога на рассвете', description: '', starts_at: starts_at.toISOString(), ends_at: null, place: 'Ми Кхе', address: null, price: null, tags: [], telegram_username: 'marina_yoga', whatsapp_phone: null, url: null },
    telegram_username: 'marina_yoga',
  });
  const ask = host.ask;
  let asked: Parameters<typeof host.ask>[0] = [];
  host.ask = async (history) => ((asked = history), parseSupportReply('Марина, здравствуйте. На вашу йогу записался один человек.'));

  // Гость записывается; роль выключена — ничего не происходит.
  assert.equal((await call(tma(71, 'Аня'), 'POST', '/collected-events/hostchan-7-0/signup')).status, 200);
  await recordHostLead(db, external_id);
  assert.equal((await inbox()).conversations.length, 0);

  // Роль включена, но профиль организатора сборщик ещё не собрал — писать некому.
  settings.hostUrl = 'http://host.test';
  await recordHostLead(db, external_id);
  assert.equal((await inbox()).conversations.length, 0);

  await db.insert(hosts).values({ telegram_id: 9300, username: 'marina_yoga', name: 'Марина' });
  sent.length = 0;
  await recordHostLead(db, external_id);
  assert.match(asked[0]!.content, /«Йога на рассвете»[^\n]*записались: 1\. Страница: \S+\/e\/hostchan-7-0[\s\S]*«Это моё»/);
  assert.match(asked[1]!.content, /Марина \(@marina_yoga\)/);
  let feed = await inbox();
  assert.deepEqual(feed.conversations.map((c) => [c.channel, c.peer_id, c.peer_name, c.attention]), [['account', 9300, 'Марина', 'Черновик организатору']]);
  const draft = feed.messages[0]!;
  assert.deepEqual([draft.status, draft.author, draft.meta], ['draft', 'agent:host', { reason: 'На «Йога на рассвете» через нас записались' }]);
  assert.deepEqual([feed.conversations[0]!.kind, feed.conversations[0]!.stage], ['organizer', 'draft'], 'кто это и на каком шаге');
  assert.deepEqual(sent.map(([, b]) => b.chat_id), [70], 'оповещение нам, организатору пока ничего');

  // Вторая запись на то же событие, пока черновик ждёт, — второго черновика нет.
  await recordHostLead(db, external_id);
  assert.equal((await inbox()).messages.length, 1);

  // Отправляем: сообщение уходит в личку (без адреса в чате), диалог остаётся за ролью.
  const [account] = await db.insert(tgAccounts).values({ label: 'Аня', phone: '+84900000019', status: 'active' }).returning();
  // Часы API на секунду впереди часов базы (в проде это разные машины): время сообщений всё равно ставит база,
  // иначе ответ организатора ниже окажется «раньше» нашего сообщения.
  mock.timers.enable({ apis: ['Date'], now: Date.now() + 1000 });
  try {
    assert.equal((await call(admin, 'POST', `/admin/messages/${draft.id}/send`, {})).status, 204);
  } finally {
    mock.timers.reset();
  }
  feed = await inbox();
  assert.deepEqual([feed.messages[0]!.status, feed.messages[0]!.meta?.reply_to, feed.conversations[0]!.mode, feed.conversations[0]!.account_id], ['queued', undefined, 'agent', account!.id]);
  assert.equal(feed.conversations[0]!.stage, 'contacted');

  // Организатор отвечает на аккаунт — роль готовит черновик ответа, видя всю переписку.
  const report = (text: string) =>
    app.request('/internal/account-message', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-collector-secret': 'collector-secret' },
      body: JSON.stringify({ account_id: account!.id, peer: { id: 9300, name: 'Марина', username: 'marina_yoga' }, direction: 'in', text }),
    });
  const drafted = async () => {
    for (let i = 0; i < 50; i++) {
      const found = (await inbox()).messages.find((m) => m.status === 'draft');
      if (found) return found;
      await new Promise((r) => setTimeout(r, 20));
    }
    return assert.fail('черновик ответа не появился');
  };
  host.ask = async (history) => ((asked = history), parseSupportReply('Да, это бесплатно.'));
  assert.equal((await report('А это платно?')).status, 204);
  const reply = await drafted();
  assert.equal((await inbox()).conversations[0]!.stage, 'replied');
  // Разделы «Агенты» и «Организаторы»: кто ведёт диалог, что агент сделал, что известно об организаторе.
  assert.equal((await inbox()).conversations[0]!.agent, 'host');
  assert.equal((await call(tma(71, 'Аня'), 'GET', '/admin/overview')).status, 403);
  const overview = (await (await call(admin, 'GET', '/admin/overview')).json()) as AdminOverview;
  assert.deepEqual(overview.agents.find((x) => x.key === 'host'), { key: 'host', enabled: true, conversations: 1, drafts: 1, sent: 1, sent_today: 1 });
  assert.deepEqual(overview.agents.find((x) => x.key === 'hunter'), { key: 'hunter', enabled: false, conversations: 0, drafts: 0, sent: 0, sent_today: 0 });
  const marina = overview.hosts.find((h) => h.username === 'marina_yoga')!;
  assert.deepEqual([marina.name, marina.registered, marina.events, marina.signups, marina.stage, marina.conversation_id], ['Марина', false, 1, 1, 'replied', (await inbox()).conversations[0]!.id]);
  assert.deepEqual([reply.text, reply.meta, (await inbox()).conversations[0]!.attention], ['Да, это бесплатно.', { reason: 'Ответ организатору' }, 'Черновик ответа организатору']);
  assert.deepEqual(asked.slice(1).map((t) => [t.role, t.content]), [['assistant', 'Марина, здравствуйте. На вашу йогу записался один человек.'], ['user', 'А это платно?']]);

  // Новое сообщение заменяет неотправленный черновик; роль зовёт человека — причина видна в «Ждут вас».
  host.ask = async () => parseSupportReply('Передал вопрос команде.\n[[человек: просит убрать событие]]');
  await report('Уберите моё событие из каталога');
  for (let i = 0; i < 50 && (await inbox()).conversations[0]!.attention !== 'просит убрать событие'; i++) await new Promise((r) => setTimeout(r, 20));
  feed = await inbox();
  assert.deepEqual([feed.conversations[0]!.attention, feed.messages.filter((m) => m.status === 'draft').map((m) => m.text)], ['просит убрать событие', ['Передал вопрос команде.']]);

  // Мы забрали диалог себе — роль больше не отвечает.
  await call(admin, 'PATCH', `/admin/conversations/${feed.conversations[0]!.id}`, { mode: 'human' });
  host.ask = async () => assert.fail('диалог ведём мы');
  await report('Вы тут?');

  // Организатор вошёл в сервис — агент своего добился: неотправленное предложение пропадает, новых не будет.
  await db.execute(sql`truncate conversations cascade`);
  host.ask = async () => parseSupportReply('Марина, здравствуйте. На вашу йогу записался один человек.');
  await recordHostLead(db, external_id);
  assert.equal((await inbox()).messages.filter((m) => m.status === 'draft').length, 1);
  assert.equal((await call(tma(9300, 'Марина'), 'GET', '/me')).status, 200); // вход организатора
  feed = await inbox();
  assert.deepEqual([feed.messages.filter((m) => m.status === 'draft').length, feed.conversations[0]!.attention], [0, null]);
  await db.execute(sql`truncate conversations cascade`);
  await recordHostLead(db, external_id);
  assert.equal((await inbox()).conversations.length, 0, 'вошедшему не пишем');
  await db.update(hosts).set({ user_id: null }).where(eq(hosts.telegram_id, 9300));

  // Событие уже подтверждено организатором — писать незачем.
  await db.execute(sql`truncate conversations cascade`);
  await db.update(collectedEvents).set({ claimed_event_id: (await newEvent(tma(70, 'Админ'))).event.id }).where(eq(collectedEvents.external_id, external_id));
  await recordHostLead(db, external_id);
  assert.equal((await inbox()).conversations.length, 0);

  host.ask = ask;
  Object.assign(settings, { hostUrl: '', collectorSecret: '' });
});

test('MCP для оператора: любое событие сервиса, от имени его организатора', async () => {
  settings.adminIds = [70];
  const mcp = async (auth: string, method: string, params?: object) =>
    ((await (await call(auth, 'POST', '/mcp', { jsonrpc: '2.0', id: 1, method, params })).json()) as { result: any }).result;
  const tool = async (auth: string, name: string, args: object) => JSON.parse((await mcp(auth, 'tools/call', { name, arguments: args })).content[0].text);
  const admin = tma(70, 'Админ');
  const { event } = await newEvent(tma(81, 'Олег'), { name: 'Покер у Олега', start_at: new Date(Date.now() + 86_400_000).toISOString() });
  assert.equal((await call(tma(82, 'Даша'), 'POST', `/events/${event.id}/rsvp`, { approval_status: 'declined' })).status, 200);

  assert.ok(!(await mcp(tma(82, 'Даша'), 'tools/list')).tools.some((t: { name: string }) => t.name.startsWith('admin_')), 'не админу их не видно');
  assert.ok((await tool(admin, 'admin_events_list', {})).some((e: any) => e.event.id === event.id && e.host_name === 'Олег'));
  // Админ видит чужое событие глазами организатора — в том числе отказавшихся — и может его изменить.
  assert.deepEqual((await tool(admin, 'admin_events_get', { event_id: event.id })).guest_counts, { approved: 0, maybe: 0, declined: 1 });
  assert.equal((await tool(admin, 'admin_events_update', { event_id: event.id, name: 'Покер в пятницу' })).event.name, 'Покер в пятницу');
  assert.deepEqual(await tool(admin, 'admin_events_get', { event_id: 'e_nope' }), { error: 'not_found' });

  // Те же операции через REST — для админки; не админу закрыты.
  const rest = async (path: string) => (await call(admin, 'GET', path)).json() as Promise<any>;
  assert.equal((await call(tma(82, 'Даша'), 'GET', '/admin/events')).status, 403);
  assert.ok((await rest('/admin/events')).some((e: any) => e.event.id === event.id && e.host_name === 'Олег'));
  assert.deepEqual((await rest(`/admin/events/${event.id}`)).guest_counts, { approved: 0, maybe: 0, declined: 1 });
  assert.equal((await (await call(admin, 'PATCH', `/admin/events/${event.id}`, { name: 'Покер в субботу' })).json() as any).event.name, 'Покер в субботу');
  assert.deepEqual((await rest('/admin/users?query=u81')).map((u: any) => u.id), [81]);
  assert.equal((await call(admin, 'GET', '/admin/users')).status, 400);
  for (const path of ['/admin/hosts', '/admin/accounts', '/admin/covers']) assert.ok(Array.isArray(await rest(path)), path);

  // От имени другого человека: админ создаёт событие за Олега и отвечает за Дашу; гостю такой параметр не дан.
  assert.deepEqual((await tool(admin, 'admin_users_search', { query: 'u81' })).map((u: any) => u.id), [81]);
  const made = await tool(admin, 'events_create', { as_user_id: 81, kind: 'o', name: 'Турнир', start_at: '2027-02-01T19:00:00+07:00', timezone: 'Asia/Ho_Chi_Minh' });
  assert.ok((await tool(tma(81, 'Олег'), 'events_list', {})).some((e: any) => e.event.id === made.event.id && e.is_host), 'событие принадлежит Олегу');
  assert.equal((await tool(admin, 'events_rsvp', { as_user_id: 82, event_id: made.event.id, approval_status: 'approved' })).me.user_id, 82);
  assert.deepEqual(await tool(admin, 'events_list', { as_user_id: 999_999 }), { error: 'user_not_found' });
  const forged = await tool(tma(82, 'Даша'), 'events_update', { as_user_id: 81, event_id: made.event.id, name: 'Взлом' });
  assert.deepEqual(forged, { error: 'forbidden' }, 'гость не может действовать за другого');

  // Каталог из анонсов: кто записался, убрать событие по просьбе организатора.
  await db.execute(sql`delete from collected_events where channel = 'opchan'`);
  const starts_at = new Date(Date.now() + 86_400_000);
  await db.insert(collectedEvents).values({
    external_id: 'telegram:opchan/1#0', channel: 'opchan', status: 'published' as const, starts_at, signup_url: '', announcement: { url: 'https://t.me/opchan/1' },
    event: { title: 'Баня', description: '', starts_at: starts_at.toISOString(), ends_at: null, place: null, address: null, price: null, tags: [], telegram_username: 'banya', whatsapp_phone: null, url: null },
    telegram_username: 'banya',
  });
  assert.equal((await call(tma(82, 'Даша'), 'POST', '/collected-events/opchan-1-0/signup')).status, 200);
  assert.deepEqual((await tool(admin, 'admin_collected_events_get', { collected_event_id: 'opchan-1-0' })).signups.map((u: any) => u.id), [82]);
  assert.deepEqual((await rest('/admin/collected-events/opchan-1-0')).signups.map((u: any) => u.id), [82]);
  // Обычный пользователь через MCP: то же, что кнопки на странице события.
  assert.equal((await tool(tma(82, 'Даша'), 'collected_events_get', { collected_event_id: 'opchan-1-0' })).signups_count, 1);
  assert.equal((await tool(tma(83, 'Петя'), 'collected_events_signup', { collected_event_id: 'opchan-1-0' })).id, 'opchan-1-0');
  assert.deepEqual((await tool(tma(83, 'Петя'), 'users_get_self', {})).collected_signups, ['opchan-1-0']);
  assert.deepEqual(await tool(tma(83, 'Петя'), 'collected_events_claim', { collected_event_id: 'opchan-1-0' }), { error: 'forbidden' });
  await tool(admin, 'admin_collected_events_delete', { collected_event_id: 'opchan-1-0' });
  assert.equal((await app.request('/collected-events/opchan-1-0')).status, 404);
  assert.deepEqual(await tool(admin, 'admin_collected_events_delete', { collected_event_id: 'opchan-1-0' }), { error: 'not_found' });
  assert.ok(Array.isArray(await tool(admin, 'admin_accounts_list', {})) && Array.isArray(await tool(admin, 'admin_hosts_list', {})));
});

// Правило «операция = сервис + REST + MCP» (docs/agents/api.md). Добавил инструмент или маршрут — допиши строку сюда:
// пару или исключение с причиной в docs/agents/api.md.
test('парность: у каждого инструмента MCP есть маршрут REST и наоборот', async () => {
  const PAIRS: Record<string, string> = {
    collected_events_list: 'GET /collected-events',
    collected_events_get: 'GET /collected-events/:id',
    collected_events_claim: 'POST /collected-events/:id/claim',
    collected_events_signup: 'POST /collected-events/:id/signup',
    users_get_self: 'GET /me',
    me_collected_list: 'GET /me/collected',
    contacts_list: 'GET /contacts',
    events_list: 'GET /events',
    events_create: 'POST /events',
    events_get: 'GET /events/:id',
    events_update: 'PATCH /events/:id',
    events_rsvp: 'POST /events/:id/rsvp',
    events_ticket_types_create: 'POST /events/:id/ticket-types',
    events_ticket_types_update: 'PATCH /ticket-types/:id',
    events_ticket_types_delete: 'DELETE /ticket-types/:id',
    admin_conversations_list: 'GET /admin/inbox',
    admin_conversations_get: 'GET /admin/conversations/:id/messages',
    admin_conversations_update: 'PATCH /admin/conversations/:id',
    admin_messages_send: 'POST /admin/conversations/:id/messages',
    admin_drafts_send: 'POST /admin/messages/:id/send',
    admin_drafts_reject: 'DELETE /admin/messages/:id',
    admin_accounts_list: 'GET /admin/accounts',
    admin_events_list: 'GET /admin/events',
    admin_events_get: 'GET /admin/events/:id',
    admin_events_update: 'PATCH /admin/events/:id',
    admin_users_search: 'GET /admin/users',
    admin_hosts_list: 'GET /admin/hosts',
    admin_overview_get: 'GET /admin/overview',
    admin_collected_events_list: 'GET /admin/collected-events',
    admin_collected_events_update: 'PATCH /admin/collected-events/:id',
    admin_collected_events_get: 'GET /admin/collected-events/:id',
    admin_collected_events_delete: 'DELETE /admin/collected-events/:id',
    admin_collected_events_redo: 'POST /admin/collected-events/:id/redo',
    admin_covers_list: 'GET /admin/covers',
    admin_covers_set: 'POST /admin/covers/:id',
    admin_videos_request: 'POST /admin/videos/:id',
  };
  const MCP_ONLY = ['person_events_list', 'person_events_get', 'person_events_create', 'person_events_update'];
  const REST_ONLY = [
    'GET /health', 'GET /config', 'GET /photos/:id', 'POST /telegram/webhook', 'POST /internal/account-message', 'POST /internal/lead',
    'GET /auth/telegram/login', 'GET /auth/telegram/callback', 'POST /auth/logout', 'POST /tokens', 'DELETE /tokens',
    'POST /collected-events/:id/visit', 'POST /events/:id/visit',
    'POST /admin/accounts', 'POST /admin/accounts/:id/login', 'DELETE /admin/accounts/:id',
  ];

  settings.adminIds = [70];
  await call(tma(70, 'Админ'), 'GET', '/events');
  const res = await call(`Bearer ${await issueToken(db, 70)}`, 'POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const tools = ((await res.json()) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
  assert.deepEqual(tools.sort(), [...Object.keys(PAIRS), ...MCP_ONLY].sort());

  // Маршруты приложения без промежуточных обработчиков (у них метод ALL) и самого входа MCP.
  const routes = [...new Set(app.routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method} ${r.path}`))];
  assert.deepEqual(routes.sort(), [...Object.values(PAIRS), ...REST_ONLY].sort());
});
