// Тесты на настоящем Postgres (нужен `pnpm db:up`). Работают в отдельной базе yaswami_test, рабочую не трогают.
import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync, sign } from 'node:crypto';
import { after, before, test } from 'node:test';
import { asc, eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import type { CollectedEventItem, Contact, Conversation, EventView, InboxFeed, Me, Message, TgAccount } from '@yaswami/core';
import { createApp } from './app.ts';
import { handleUpdate, REPLIES } from './bot.ts';
import { bot } from './telegram.ts';
import type { CollectedEvent } from '@yaswami/core';
import { issueToken, verifyInitData } from './auth.ts';
import type { Db } from './db/client.ts';
import { createDb } from './db/client.ts';
import { collectedEvents, hosts, photos, visits, tgAccounts } from './db/schema.ts';
import { saveUserPhoto } from './photos.ts';
import { settings } from './settings.ts';
import { parseSupportReply, support, verifyTicket } from './support.ts';
import { eventPage, feedPage, inject, sitemap } from './pages.ts';
import { ISSUER, safeReturn, verifyIdToken } from './web-login.ts';

const BOT_TOKEN = '123456:test-token';
const url = new URL(process.env.DATABASE_URL ?? 'postgres://yaswami:yaswami@localhost:5432/yaswami');
let db: Db;
let app: ReturnType<typeof createApp>;

before(async () => {
  const admin = postgres(url.href, { max: 1 });
  const [found] = await admin`select 1 from pg_database where datname = 'yaswami_test'`;
  if (!found) await admin`create database yaswami_test`;
  await admin.end();
  url.pathname = '/yaswami_test';
  db = createDb(url.href);
  await migrate(db, { migrationsFolder: new URL('../drizzle', import.meta.url).pathname });
  await db.execute(sql`truncate users cascade`);
  app = createApp({ db, botToken: BOT_TOKEN });
});
after(() => db.$client.end());

// Всё, что бот «отправил» за тест. Настоящих запросов к Telegram нет.
const sent: [method: string, body: any][] = [];
bot.call = async (method, body) => (sent.push([method, body]), { ok: true });
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
    'catalog_events', 'event_create', 'event_get', 'event_rsvp', 'event_update', 'events_list',
    'ticket_type_create', 'ticket_type_delete', 'ticket_type_update',
  ]);
  const create = tools.find((t: { name: string }) => t.name === 'event_create');
  assert.deepEqual(create.inputSchema.required.sort(), ['kind', 'name', 'start_at', 'timezone']);

  const created = await rpc('tools/call', {
    name: 'event_create',
    arguments: { kind: 'c', name: 'Кофе', start_at: '2026-12-01T10:00:00+04:00', timezone: 'Asia/Tbilisi', max_capacity: 1 },
  });
  const view = JSON.parse(created.content[0].text) as EventView;
  assert.equal(view.is_host, true);

  // событие, созданное через MCP, видно в REST
  await call(tma(9, 'Лёша'), 'POST', `/events/${view.event.id}/rsvp`, { approval_status: 'approved' });
  const full = await rpc('tools/call', { name: 'event_rsvp', arguments: { event_id: view.event.id, approval_status: 'approved' } });
  assert.equal(full.isError, true);
  assert.deepEqual(JSON.parse(full.content[0].text), { error: 'full' });

  const invalid = await rpc('tools/call', { name: 'event_create', arguments: { kind: 'zzz', name: 'x' } });
  assert.equal(invalid.isError, true);
});

test('собранные события: витрина без входа, запись — после входа, вход по cookie сайта', async () => {
  await db.delete(collectedEvents);
  const row = (external_id: string, starts_at: Date) => ({
    external_id, channel: 'danangevent', starts_at, signup_url: 'https://t.me/anna_yoga?text=hi',
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
    external_id: 'telegram:danangevent/5#0', channel: 'danangevent', starts_at, signup_url: '',
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
    event: e, starts_at: new Date(e.starts_at), telegram_username: 'u62', signup_url: 'https://t.me/u62',
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
  const item = async (slug: string) => (await (await app.request(`/collected-events/${slug}`)).json()) as CollectedEventItem;

  sent.length = 0;
  await handleUpdate(db, async () => [e], forward(64, channel));
  // Ключ и адрес — как у сборщика: когда он дойдёт до этой публикации, второй записи не появится.
  const added = await item('danangevent-777-0');
  assert.deepEqual([added.title, added.source_url, added.claimed_event_id], ['Экстатик дэнс у моря', 'https://t.me/DanangEvent/777', null]);
  assert.deepEqual(await (await call(tma(64, 'Аня'), 'GET', '/events')).json(), [], 'событие Ясвами не создано, лимит не тронут');
  assert.deepEqual(sent.map(([m, b]) => [m, b.chat_id, JSON.parse(b.public_data).l]), [['sendWidget', 64, 'Добавлено на витрину']]);
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
    external_id: 'telegram:photochan/1#0', channel: 'photochan', announcement: { url: 'https://t.me/photochan/1' }, signup_url: 'https://t.me/photochan/1',
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
  assert.ok(!(await toolNames(tma(71, 'Аня'))).includes('message_send'));
  assert.ok((await toolNames(admin)).includes('message_send'));
  const tool = async (name: string, args: object) => JSON.parse((await mcp(admin, 'tools/call', { name, arguments: args })).content[0].text);
  assert.deepEqual((await tool('conversations_list', { waiting_only: true })).map((c: Conversation) => c.id), [id]);
  sent.length = 0;
  await tool('message_send', { conversation_id: id, text: 'Сегодня в 19:00 покер, записать?' });
  assert.deepEqual(sent.map(([, b]) => b.text), ['Сегодня в 19:00 покер, записать?']);
  const read = await tool('conversation_get', { conversation_id: id });
  assert.deepEqual([read.conversation.mode, read.messages.at(-1).author], ['human', 'agent']);
  assert.deepEqual(await tool('conversations_list', { waiting_only: true }), []);

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
  const made = await tool('person_event_create', { ticket, kind: 'o', name: 'Йога на пляже', start_at: '2027-01-10T07:00:00+07:00', timezone: 'Asia/Ho_Chi_Minh' });
  assert.equal(made.is_host, true);
  assert.ok(made.url.includes(made.event.id));
  assert.ok((await tool('person_events', { ticket })).some((e: any) => e.event.name === 'Йога на пляже' && e.is_host), 'в списке событий человека');
  assert.equal((await tool('person_event_update', { ticket, event_id: made.event.id, name: 'Йога на рассвете' })).event.name, 'Йога на рассвете');
  assert.deepEqual(await tool('person_events', { ticket: 'подделка' }), { error: 'bad_ticket' });
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
