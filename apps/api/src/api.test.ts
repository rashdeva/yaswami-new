// Тесты на настоящем Postgres (нужен `pnpm db:up`). Работают в отдельной базе yaswami_test, рабочую не трогают.
import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync, sign } from 'node:crypto';
import { after, before, test } from 'node:test';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import type { CollectedEventItem, EventView, Me } from '@yaswami/core';
import { createApp } from './app.ts';
import { issueToken, verifyInitData } from './auth.ts';
import type { Db } from './db/client.ts';
import { createDb } from './db/client.ts';
import { collectedEvents } from './db/schema.ts';
import { settings } from './settings.ts';
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
  assert.equal(created.event.start_at, '2026-11-20T15:00:00.000Z');

  const res = await call(tma(2, 'Дато'), 'POST', `/events/${created.event.id}/rsvp`, { approval_status: 'approved' });
  assert.equal(res.status, 200);
  const view = (await res.json()) as EventView;
  assert.deepEqual(view.guest_counts, { approved: 1, maybe: 0, declined: 0 });
  assert.equal(view.event.rev, 1);
  assert.deepEqual(view.guests, [
    { user_first_name: 'Дато', approval_status: 'approved', event_ticket_type_id: created.ticket_types[0]!.id, plus_ones: 0, is_me: true },
  ]);
  assert.equal(view.is_host, false);

  const list = (await (await call(tma(2, 'Дато'), 'GET', '/events')).json()) as { my_approval_status: string; is_host: boolean }[];
  assert.deepEqual(list.map((e) => [e.my_approval_status, e.is_host]), [['approved', false]]);
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
    'event_create', 'event_get', 'event_rsvp', 'event_update', 'events_list',
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
  ]);

  // витрина: только предстоящие, контакт организатора — только внутри ссылки записи
  const items = (await (await app.request('/collected-events')).json()) as CollectedEventItem[];
  assert.deepEqual(items.map((i) => i.id), ['danangevent-1-0']);
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
    signup_url: 'https://t.me/anna_yoga', source_url: 'https://t.me/danangevent/1', claimed_event_id: null,
  };
  const template = '<html><head><title>Я с вами</title></head><body><div id="app"></div></body></html>';
  const html = inject(template, eventPage(event, 'https://yaswami.test', 'Дананг'));
  assert.match(html, /<title>Йога &#60;b&#62;&#38; чай&#60;\/b&#62; — сб, 14 ноября, 19:00, Дананг<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/yaswami.test\/e\/danangevent-1-0" \/>/);
  assert.match(html, /"startDate":"2026-11-14T19:00:00\+07:00"/);
  assert.equal(html.includes('<script>alert(1)'), false);
  assert.equal(html.includes('$& утро'), true); // «$&» в тексте не превратилось в кусок шаблона
  assert.equal((html.match(/<\/script>/g) ?? []).length, 2); // только свои: JSON-LD и начальные данные

  const feed = inject(template, feedPage([event], 'https://yaswami.test', 'Дананг'));
  assert.match(feed, /<h2>суббота, 14 ноября<\/h2><ul><li><a href="\/e\/danangevent-1-0">/);
  assert.match(sitemap([event], 'https://yaswami.test'), /<loc>https:\/\/yaswami.test\/e\/danangevent-1-0<\/loc>/);
});
