// Тесты на настоящем Postgres (нужен `pnpm db:up`). Работают в отдельной базе yaswami_test_<checkout>, рабочую не трогают.
import assert from 'node:assert/strict';
import { createDecipheriv, createHash, createHmac, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { after, before, mock, test } from 'node:test';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import type { AdminAction, AdminActionList, AdminCollectedEvent, AdminGuest, AdminOverview, AdminSource, City, CollectedEventItem, Contact, Conversation, EventView, Host, HostItem, HostListItem, InboxFeed, Me, Message, PracticeSignup, TgAccount } from '@yaswami/core';
import { createApp } from './app.ts';
import { DRAFT_PLACEHOLDER, handleUpdate, REPLIES, welcomePhotoUrl } from './bot.ts';
import { collectedWhen, sseEvents, TOPIC_GUIDES } from '@yaswami/core';
import { bot } from './telegram.ts';
import type { CollectedEvent } from '@yaswami/core';
import { issueToken, verifyInitData } from './auth.ts';
import type { Db } from './db/client.ts';
import { createDb } from './db/client.ts';
import { adminActions, collectedEvents, contacts, conversations, guests, hosts, messages, photos, practiceSignups, sources, ticketTypes, users, visits, tgAccounts } from './db/schema.ts';
import { afterCommit, audited } from './audit.ts';
import { AppError, updateEvent } from './services.ts';
import { saveUserPhoto } from './photos.ts';
import { listCollectedForAdmin, requestNextCover, requestNextVideo } from './services.ts';
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
  await db.execute(sql`truncate users, admin_actions, collected_events, hosts, tg_accounts, conversations cascade`);
  // Города из прошлого запуска: Дананг создан миграцией, остальное добавляют тесты.
  await db.execute(sql`delete from sources where city_id <> 'danang'`);
  await db.execute(sql`delete from cities where id <> 'danang'`);
  app = createApp({ db, botToken: BOT_TOKEN });
});
after(() => db.$client.end());

// Всё, что бот «отправил» за тест. Настоящих запросов к Telegram нет.
const sent: [method: string, body: any][] = [];
let lastMessageId = 5000;
bot.call = async (method, body) => (sent.push([method, body]), { ok: true, result: { message_id: ++lastMessageId } });
Object.assign(bot.pace, { globalMs: 0, chatMs: 0 });
// В тестах создание событий открыто всем, как было до возможностей; сам запрет проверяет тест «возможность event_create».
settings.featuresOn = ['event_create'];
// Лимит запросов в минуту тестам мешал бы: один «пользователь» делает их сотни. Сам лимит проверяет тест «безопасность».
settings.requestsPerMinute = Infinity;

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

test('обложка события: без своей рисует иллюстратор, картинка из ответа роли сохраняется у события', async () => {
  // PNG 1×1: так Hermes отдаёт нарисованное ChatGPT — data URL вместо MEDIA:<путь>.
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  assert.equal(parseIllustration(`cover: ![image](data:image/png;base64,${png})`).cover_url, `data:image/png;base64,${png}`);

  const draw = illustrator.ask;
  let task = '';
  let drawn!: () => void;
  const done = new Promise<void>((resolve) => (drawn = resolve));
  settings.illustratorUrl = 'http://illustrator.test';
  illustrator.ask = async (t) => ((task = t), setTimeout(drawn, 50), { cover_url: `data:image/png;base64,${png}`, video_url: null, keep: false });
  try {
    const host = tma(3, 'Лена');
    const created = await newEvent(host);
    assert.deepEqual([created.cover_url, created.cover_pending], [null, true], 'событие создаётся сразу, обложка рисуется');
    await done;
    assert.match(task, /^Сделай только обложку/);
    const view = (await (await call(host, 'GET', `/events/${created.event.id}`)).json()) as EventView;
    assert.match(view.cover_url ?? '', /\/api\/photos\//);
    assert.equal(view.cover_pending, false);
    const img = await app.request(new URL(view.cover_url!).pathname.replace(/^\/api/, ''));
    assert.deepEqual([img.status, img.headers.get('content-type')], [200, 'image/jpeg'], 'картинка отдаётся, PNG перекодирован в JPEG');
  } finally {
    illustrator.ask = draw;
    settings.illustratorUrl = '';
  }
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
    'events_ticket_types_update', 'events_update', 'hosts_get', 'hosts_list', 'hosts_practices_signup', 'me_collected_list', 'users_get_self',
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
    { ...row('telegram:danangevent/3#0', new Date(Date.now() + 2 * 86_400_000)), reactions: 12,
      announcement: { url: 'https://t.me/danangevent/3', media: [{ type: 'video' as const, url: 'https://media.x/telegram/danangevent/3.mp4' }] } },
  ]);

  // витрина: только предстоящие, контакт организатора — только внутри ссылки записи
  const items = (await (await app.request('/collected-events')).json()) as CollectedEventItem[];
  // отклик на анонс наружу не отдаём: из него только пометка «Популярное»
  assert.deepEqual(items.map((i) => [i.id, i.popular, 'reactions' in i]), [['danangevent-1-0', false, false], ['danangevent-3-0', true, false]]);
  assert.equal(((await (await app.request('/collected-events/danangevent-3-0')).json()) as CollectedEventItem).popular, true);
  // фото и видео публикации — как их сохранил сборщик; у публикации без медиа — пустой список
  assert.deepEqual(items.map((i) => i.media), [[], [{ type: 'video', url: 'https://media.x/telegram/danangevent/3.mp4' }]]);
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
  assert.deepEqual(await (await call(guest, 'GET', '/me')).json(), { user: { id: 20, first_name: 'Оля', username: 'u20' }, features: ['event_create'], collected_signups: ['danangevent-1-0'], claimable: [] });

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

test('каталог организаторов: с событиями или Practice из наших тем, страница с событиями', async () => {
  await db.delete(collectedEvents);
  await db.delete(hosts);
  const starts_at = new Date(Date.now() + 86_400_000);
  const event = (title: string, topic: string, username: string) => ({
    title, description: '', starts_at: starts_at.toISOString(), ends_at: null, place: null, address: null, price: null, tags: [],
    telegram_username: username, whatsapp_phone: null, url: null, topic,
  });
  await db.insert(collectedEvents).values([
    { external_id: 'telegram:mafia/1#0', channel: 'mafia', status: 'published' as const, starts_at, signup_url: '', announcement: { url: 'https://t.me/mafia/1' }, event: event('Мафия', 'игры', 'club'), telegram_username: 'club' },
    { external_id: 'telegram:mafia/2#0', channel: 'mafia', status: 'pending' as const, starts_at, signup_url: '', announcement: { url: 'https://t.me/mafia/2' }, event: event('Скрытое', 'игры', 'club'), telegram_username: 'club' },
  ]);
  await db.insert(hosts).values([
    { telegram_id: 40, username: 'club', name: 'Клуб мафии', summary: 'Играют по пятницам.' },
    { telegram_id: 41, username: 'dasha_yoga', name: 'Даша', summary: 'Ведёт йогу.', status: 'published' as const, practices: [
      { title: 'Утренняя йога', topic: 'йога', description: 'Группа у моря.', price: '150k' },
      { title: 'Ремонт телефонов', topic: 'другое', description: null, price: null }, // не наша тема — не показываем
    ] },
    { telegram_id: 42, username: 'nobody', name: 'Без всего' }, // ни событий, ни Practice — не в каталоге
    // мастер ждёт модерации: Practice есть, но в каталоге его нет, пока команда не одобрит
    { telegram_id: 43, username: 'new_master', name: 'Новый мастер', practices: [{ title: 'Массаж', topic: 'телесные практики', description: null, price: null }] },
  ]);

  const list = (await (await app.request('/hosts')).json()) as HostListItem[];
  assert.deepEqual(list.map((h) => [h.username, h.upcoming_count, h.topics, h.practices.map((p) => p.title)]), [
    ['club', 1, ['игры'], []],
    ['dasha_yoga', 0, ['йога'], ['Утренняя йога']],
  ]);
  assert.equal(list[1]!.contact_url, 'https://t.me/dasha_yoga');


  const club = (await (await app.request(`/hosts/${list[0]!.id}`)).json()) as HostItem;
  assert.deepEqual(club.events.map((e) => e.title), ['Мафия']); // неопубликованное не видно
  assert.equal((await app.request('/hosts/not-an-id')).status, 404);
  const [nobody] = await db.select().from(hosts).where(eq(hosts.username, 'nobody'));
  assert.equal((await app.request(`/hosts/${nobody!.id}`)).status, 404);

  // запись на Practice: намерение записано, человек получает ссылку на чат мастера; повтор ничего не меняет
  const dasha = list[1]!;
  const signup = () => call(tma(90, 'Оля'), 'POST', `/hosts/${dasha.id}/practices/signup`, { title: 'Утренняя йога' });
  const { signup_url } = (await (await signup()).json()) as PracticeSignup;
  assert.match(signup_url, /^https:\/\/t\.me\/dasha_yoga\?text=/);
  assert.equal((await signup()).status, 200);
  assert.equal((await db.select().from(practiceSignups)).length, 1);
  assert.equal((await call(tma(90, 'Оля'), 'POST', `/hosts/${dasha.id}/practices/signup`, { title: 'Ремонт телефонов' })).status, 404); // не наша тема
  assert.equal((await app.request(`/hosts/${dasha.id}/practices/signup`, { method: 'POST' })).status, 401);

  // модерация: одобренный мастер появляется в каталоге, отклонённый организатор пропадает даже с событиями
  const [master] = await db.select().from(hosts).where(eq(hosts.username, 'new_master'));
  const admins = settings.adminIds;
  settings.adminIds = [70];
  const admin = tma(70, 'Админ');
  assert.equal((await call(admin, 'PATCH', `/admin/hosts/${master!.id}`, { status: 'published' })).status, 200);
  assert.deepEqual(((await (await app.request('/hosts')).json()) as HostListItem[]).map((h) => h.username), ['club', 'dasha_yoga', 'new_master']);
  assert.equal((await call(admin, 'PATCH', `/admin/hosts/${list[0]!.id}`, { status: 'rejected' })).status, 200);
  assert.deepEqual(((await (await app.request('/hosts')).json()) as HostListItem[]).map((h) => h.username), ['dasha_yoga', 'new_master']);
  assert.equal((await app.request(`/hosts/${list[0]!.id}`)).status, 404);
  settings.adminIds = admins;
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
  // подтвердивший — организатор: создание событий открыто ему лично, даже когда оно закрыто для всех
  settings.featuresOn = [];
  try {
    assert.deepEqual(((await (await call(owner, 'GET', '/me')).json()) as Me).features, ['event_create']);
    assert.deepEqual(((await (await call(stranger, 'GET', '/me')).json()) as Me).features, []);
    await newEvent(owner);
  } finally {
    settings.featuresOn = ['event_create'];
  }
});

test('возможность event_create: без неё события не создать ни в приложении, ни через бота; открывает команда', async () => {
  settings.adminIds = [70];
  settings.featuresOn = [];
  try {
    const user = tma(45, 'Гость');
    const admin = tma(70, 'Админ');
    const body = { kind: 's', name: 'Своё', start_at: '2026-11-20T19:00:00+04:00', timezone: 'Asia/Tbilisi' };
    const features = async () => ((await (await call(user, 'GET', '/me')).json()) as Me).features;

    const res = await call(user, 'POST', '/events', body);
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: 'feature_off' });
    assert.deepEqual(await features(), []);

    // команда создаёт событие за человека — можно, возможность при этом ему не выдаётся
    assert.equal((await call(admin, 'POST', '/admin/events', { ...body, user_id: 45 })).status, 201);
    assert.deepEqual(await features(), []);

    // команда открывает создание лично; повтор в списке схлопывается
    const updated = (await (await call(admin, 'PATCH', '/admin/users/45', { features: ['event_create', 'event_create'] })).json()) as { features: string[] };
    assert.deepEqual(updated.features, ['event_create']);
    assert.deepEqual(await features(), ['event_create']);
    await newEvent(user);
    assert.equal((await call(admin, 'PATCH', '/admin/users/45', { features: ['fly'] })).status, 400);
  } finally {
    settings.featuresOn = ['event_create'];
  }
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
  for (const bad of ['//evil.test', '/\\evil.test', '/\t/evil.test', '/\n/evil.test', 'https://evil.test', undefined]) assert.equal(safeReturn(bad), '/');

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

test('сообщение боту: /start — приветствие с картинкой, остальное — роли поддержки, без неё — «ответим позже»', async () => {
  const reply = async (text: string, extra?: object) => {
    sent.length = 0;
    await handleUpdate(db, botMessage(61, text, extra));
    return sent.map(([m, b]) => (m === 'sendMessage' ? b.text : m === 'sendPhoto' ? [m, b.photo, b.caption] : m));
  };
  assert.deepEqual(await reply('/start'), [['sendPhoto', welcomePhotoUrl(), REPLIES.welcome]]);
  assert.ok(!REPLIES.welcome.includes('анонс'), 'в приветствии не просим прислать событие');
  // Telegram картинку не забрал — то же приветствие текстом.
  const stub = bot.call;
  bot.call = async (method, body) => (method === 'sendPhoto' ? { ok: false, description: 'wrong file' } : stub(method, body));
  try {
    assert.deepEqual(await reply('/start'), [REPLIES.welcome]);
  } finally {
    bot.call = stub;
  }
  assert.deepEqual(await reply(''), [REPLIES.photo], 'фото без подписи');
  // Анонс с датой больше не разбирается ботом: без роли поддержки — «ответим позже», событие не создаётся.
  assert.deepEqual(await reply(ANNOUNCEMENT), [REPLIES.unavailable]);
  assert.deepEqual(await (await call(tma(61, 'Аня'), 'GET', '/events')).json(), []);

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
  assert.deepEqual(rows.map((r) => [r.user_id, r.referrer_id]), [[903, 902]], 'повторные заходы за час строк не добавляют');
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
    await handleUpdate(db, { message: { message_id: 1, date: 1, chat: { id: 9103, type: 'private' }, from: { id: 9103, first_name: 'Гость9103' }, text: '/start' } });
    await call(tma(9103, 'Гость9103'), 'POST', `/events/${event.id}/rsvp`, { approval_status: 'approved', event_ticket_type_id: ticket });
    for (const id of [9101, 9102, 9103, 9102]) await saveUserPhoto(db, id); // дождаться фона; повтор не качает заново
    assert.deepEqual(asked.filter((a) => a !== 'sendMessage' && a !== 'sendPhoto'), [
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
  const inbox = async () => (await (await call(admin, 'GET', '/admin/inbox')).json()) as InboxFeed;
  const write = async (text: string) => {
    sent.length = 0;
    await handleUpdate(db, botMessage(71, text));
    return sent.filter(([method, b]) => (method === 'sendMessage' || method === 'sendPhoto') && b.chat_id === 71).map(([, b]) => b.text ?? b.caption); // без оповещений нам самим
  };

  assert.equal((await call(tma(71, 'Аня'), 'GET', '/admin/inbox')).status, 403, 'не админ');

  // /start — справка без пометки; вопрос, на который бот ответил отказом, ждёт нас.
  assert.deepEqual(await write('/start'), [REPLIES.welcome]);
  assert.equal((await inbox()).conversations[0]!.attention, null);
  assert.deepEqual(await write('Как записаться на покер?'), [REPLIES.unavailable]);
  let feed = await inbox();
  assert.equal(feed.me, 70);
  assert.deepEqual(feed.conversations.map((c) => [c.peer_id, c.peer_name, c.mode, c.attention]), [[71, 'Аня', 'agent', 'Бот не ответил']]);
  assert.deepEqual([feed.conversations[0]!.kind, feed.conversations[0]!.stage], ['guest', 'bot']);
  assert.deepEqual(feed.messages.map((m) => [m.direction, m.author, m.text, m.status]), [
    ['out', 'bot', REPLIES.unavailable, 'sent'],
    ['in', 'user', 'Как записаться на покер?', 'received'],
    ['out', 'bot', REPLIES.welcome, 'sent'],
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
  assert.match(sent[0]![1].text, /\/admin\/\?c=[0-9a-f-]{36}$/, 'ссылка ведёт прямо в диалог');
  assert.equal((await inbox()).conversations[0]!.attention, 'Ответил вам');
  const thread = (await (await call(admin, 'GET', `/admin/conversations/${id}/messages`)).json()) as Message[];
  assert.deepEqual(thread.map((m) => m.text).slice(-2), ['Привет! Сейчас помогу.', 'Спасибо, жду']);

  // Вернули боту — он снова отвечает.
  const back = await call(admin, 'PATCH', `/admin/conversations/${id}`, { mode: 'agent', attention: null });
  assert.deepEqual([((await back.json()) as Conversation).mode, back.status], ['agent', 200]);
  assert.deepEqual(await write('А сегодня что-нибудь есть?'), [REPLIES.unavailable]);

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
  illustrator.ask = async (t) => ((task = t), { cover_url: null, video_url: 'https://files-cdn.x.ai/abc/file_1.mp4', keep: false });
  assert.deepEqual(await tool('admin_videos_request', { id: 'danangevent-5-0' }), { started: true });
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(task.includes('"title":"Баня"') && task.includes(cover), 'роль получает данные события и фото анонса');
  assert.ok(task.startsWith('Обложка уже готова'), 'обложку проверили — роль снимает только ролик');
  assert.equal(((await (await app.request('/collected-events/danangevent-5-0')).json()) as CollectedEventItem).video_url, 'https://files-cdn.x.ai/abc/file_1.mp4');
  assert.deepEqual(await tool('admin_videos_request', { id: 'danangevent-5-0' }), { error: 'video_exists' });
  settings.illustratorDailyLimit = 1;
  await db.insert(collectedEvents).values({
    external_id: 'telegram:danangevent/6#0', channel: 'danangevent', status: 'published' as const, starts_at, signup_url: 'https://t.me/x', announcement: { url: 'https://t.me/danangevent/6' },
    event: { title: 'Йога', description: '', starts_at: starts_at.toISOString(), ends_at: null, place: null, address: null, price: null, tags: [], telegram_username: 'anna', whatsapp_phone: null, url: null },
  });
  assert.deepEqual(await tool('admin_videos_request', { id: 'danangevent-6-0' }), { error: 'video_limit' });
  assert.deepEqual(parseIllustration('cover: https://files-cdn.x.ai/a/b_1.png\nvideo: https://files-cdn.x.ai/c/d_2.mp4'),
    { cover_url: 'https://files-cdn.x.ai/a/b_1.png', video_url: 'https://files-cdn.x.ai/c/d_2.mp4', keep: false });
  assert.deepEqual(parseIllustration('cover: https://evil.example/x.png\n[[не получилось: нет фото]]'), { cover_url: null, video_url: null, keep: false }, 'чужие адреса не берём');
  assert.deepEqual(parseIllustration('cover: keep'), { cover_url: null, video_url: null, keep: true });
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
  // Одобренное ждёт проверки обложки — лимит роликов на неё не влияет — и выходит в ленту. Правка и решение — одним запросом.
  assert.equal(((await (await call(admin, 'PATCH', '/admin/collected-events/danangevent-7-0', { status: 'approved', price: '200 000 ₫' })).json()) as AdminCollectedEvent).status, 'approved');
  assert.equal(await inFeed(), false);
  illustrator.ask = async (t) => ((task = t), { cover_url: null, video_url: null, keep: true });
  assert.equal(await requestNextCover(db), 'danangevent-7-0', 'сначала одобренные');
  assert.ok(task.startsWith('Проверь обложку') && task.includes('Чайная церемония'));
  assert.equal(await inFeed(), true);
  const [checked] = await db.select().from(collectedEvents).where(eq(collectedEvents.external_id, 'telegram:danangevent/7#0'));
  assert.ok(checked!.cover_checked_at, 'фото анонса годится — оставлено, обложка проверена');
  assert.equal(((await (await app.request('/collected-events/danangevent-7-0')).json()) as CollectedEventItem).price, '200 000 ₫');
  // Перерисовать: обложка удалена, обработка сброшена; очередь возьмёт событие только через 20 минут.
  await db.update(collectedEvents).set({ video_url: 'https://files-cdn.x.ai/a/old.mp4', video_tries: 1 }).where(eq(collectedEvents.external_id, 'telegram:danangevent/7#0'));
  await db.insert(photos).values({ collected_external_id: 'telegram:danangevent/7#0', source: 'x', data: Buffer.from([0xff, 0xd8]) });
  assert.equal((await call(admin, 'POST', '/admin/collected-events/danangevent-7-0/redo')).status, 204);
  const redone = (await adminEvents()).find((e) => e.id === 'danangevent-7-0') as unknown as CollectedEventItem;
  assert.deepEqual([redone.video_url, redone.cover_url], [null, null]);
  assert.equal(await requestNextVideo(db), null, 'до возврата фото анонса очередь его не берёт');
  assert.equal(await requestNextCover(db), 'danangevent-6-0', 'и очередь обложек тоже — берёт другое');
  // Пока очередь не взяла событие, перерисовку можно отменить: обложка и ролик возвращаются.
  const redoAction = (await lastAction())!;
  assert.deepEqual([redoAction.action, redoAction.undoable], ['admin_collected_events_redo', true]);
  assert.equal((await call(admin, 'POST', `/admin/actions/${redoAction.id}/undo`)).status, 201);
  const restored = (await adminEvents()).find((e) => e.id === 'danangevent-7-0') as unknown as CollectedEventItem;
  assert.equal(restored.video_url, 'https://files-cdn.x.ai/a/old.mp4');
  assert.ok(restored.cover_url);
  // Снять с публикации и удалить.
  assert.equal((await tool('admin_collected_events_update', { collected_event_id: 'danangevent-7-0', status: 'rejected' })).status, 'rejected');
  assert.equal(await inFeed(), false);
  assert.equal((await call(admin, 'DELETE', '/admin/collected-events/danangevent-7-0')).status, 204);
  assert.equal((await adminEvents()).some((e) => e.id === 'danangevent-7-0'), false);

  // Автообход: берёт ближайшее событие без ролика с проверенной обложкой; лимит выбран — тихо пропускает.
  illustrator.ask = async (t) => ((task = t), { cover_url: null, video_url: 'https://files-cdn.x.ai/abc/file_1.mp4', keep: false });
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
  const perMinute = settings.botMessagesPerMinute;
  settings.botMessagesPerMinute = 100; // ниже человек пишет роли много раз подряд
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
  await handleUpdate(db, botMessage(71, 'Организатор взял деньги и пропал'));
  assert.deepEqual(sent.filter(([m]) => m === 'sendMessage').map(([, b]) => [b.chat_id, b.text.split('\n')[0]]), [
    [71, 'Передал команде, вам ответят.'],
    [70, 'Аня (@u71) ждёт человека: жалоба на организатора'],
  ]);
  feed = await inbox();
  assert.deepEqual([feed.conversations.length, feed.conversations[0]!.attention], [1, 'жалоба на организатора']);
  // Текст с датой бот не разбирает сам: анонс это или вопрос, решает роль.
  support.ask = async () => ({ text: 'В пятницу покер в 19:00.', human: null });
  sent.length = 0;
  await handleUpdate(db, botMessage(71, 'Что будет в пятницу 20 ноября в 19:00?'));
  assert.deepEqual(sent.filter(([m]) => m === 'sendMessage').map(([, b]) => b.text), ['В пятницу покер в 19:00.']);
  // Событие роль показывает пометкой: человек получает текст без неё и карточку с кнопкой в мини-приложение;
  // неизвестный id пропускается, а не превращается в битую карточку.
  const starts = new Date(Date.now() + 86_400_000);
  await db.insert(collectedEvents).values({
    external_id: 'telegram:cardchan/1#0', channel: 'cardchan', status: 'published' as const, starts_at: starts, signup_url: '',
    announcement: { url: 'https://t.me/cardchan/1' },
    event: { title: 'Вечер в баньке', description: '', starts_at: starts.toISOString(), ends_at: null, place: 'Банька', address: null, price: '450k', tags: [], telegram_username: null, whatsapp_phone: null, url: null },
  });
  support.ask = async () => parseSupportReply('Привет! Вот что есть сегодня:\n[[событие: cardchan-1-0]]\n[[событие: nope-1-0]]');
  bot.username = 'yaswami_bot';
  try {
    assert.deepEqual(await write('Куда сходить?'), ['Привет! Вот что есть сегодня:', `Вечер в баньке\n🗓 ${collectedWhen(starts.toISOString())}\n📍 Банька\n💸 450k`]);
    const card = sent.filter(([m]) => m === 'sendMessage').at(-1)![1];
    assert.equal(card.reply_markup.inline_keyboard[0][0].url, 'https://t.me/yaswami_bot/app?startapp=c_cardchan-1-0', 'кнопка открывает мини-приложение');
  } finally {
    bot.username = null;
  }
  // Модель роли отказала: Hermes отвечает 200 с текстом ошибки — человеку уходит прежний отказ бота, а не эта ошибка.
  support.ask = ask;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    choices: [{ message: { role: 'assistant', content: 'Billing or credits exhausted: HTTP 402' }, finish_reason: 'error' }],
    hermes: { failed: true, error: 'HTTP 402' },
  });
  try {
    assert.deepEqual(await write('Как поменять имя?'), [REPLIES.unavailable]);
  } finally {
    globalThis.fetch = realFetch;
  }
  // Роль отвечает потоком: человек сразу видит «Смотрю, что есть…», потом написанное — без пометок, даже недописанных;
  // готовый ответ уходит обычным сообщением. Второй кусок приходит позже, чем бот показывает черновик.
  const stream = (frames: string[], pauseMs = 0) => new Response(new ReadableStream({
    async start(controller) {
      for (const [i, frame] of frames.entries()) {
        if (i === 1) await new Promise((resolve) => setTimeout(resolve, pauseMs));
        controller.enqueue(new TextEncoder().encode(frame));
      }
      controller.close();
    },
  }), { headers: { 'content-type': 'text/event-stream' } });
  const chunk = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\n`;
  const drafts = () => sent.filter(([m]) => m === 'sendMessageDraft').map(([, b]) => b.text);
  globalThis.fetch = async () => stream([chunk('Сегодня бачата.\n[[собы'), chunk('тие: cardchan-1-0]]'), 'event: hermes.tool.progress\ndata: {}\n\n', ': keepalive\n\n', 'data: [DONE]\n\n'], 500);
  try {
    const answer = await write('Куда сходить вечером?');
    assert.deepEqual([answer[0], answer.length], ['Сегодня бачата.', 2], 'текст без пометки и карточка события');
    assert.deepEqual(drafts(), [DRAFT_PLACEHOLDER, 'Сегодня бачата.']);
    // Модель отказала посреди потока: текст ошибки человеку не показываем — ни черновиком, ни сообщением.
    globalThis.fetch = async () => stream([
      chunk('Billing or credits exhausted: HTTP 402'),
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'error' }], hermes: { failed: true, error: 'HTTP 402' } })}\n\n`,
      'data: [DONE]\n\n',
    ]);
    assert.deepEqual(await write('Как поменять имя?'), [REPLIES.unavailable]);
    assert.deepEqual(drafts(), [DRAFT_PLACEHOLDER]);
  } finally {
    globalThis.fetch = realFetch;
  }
  // Роль открыта только списку пользователей — остальным прежний отказ бота, роль даже не спрашиваем.
  settings.supportUserIds = [70];
  support.ask = async () => assert.fail('роль не для этого пользователя');
  assert.deepEqual(await write('А мне ответят?'), [REPLIES.unavailable]);
  settings.supportUserIds = [];
  // Роль недоступна — прежний отказ бота.
  support.ask = async () => null;
  assert.deepEqual(await write('Алло?'), [REPLIES.unavailable]);
  // Не больше нескольких сообщений роли в минуту от одного человека: каждый ответ — запрос к ИИ.
  settings.botMessagesPerMinute = 1;
  assert.deepEqual(await write('Ещё вопрос'), [REPLIES.too_often]);
  settings.botMessagesPerMinute = perMinute;
  support.ask = ask;
  settings.supportUrl = '';
  assert.deepEqual(parseSupportReply('Привет!\n[[человек:]]'), { text: 'Привет!', human: 'Просит человека', events: [] });

  // Telegram не принял сообщение: оно остаётся в ленте как недоставленное, админка получает ошибку.
  const ok = bot.call;
  bot.call = async () => ({ ok: false, error_code: 403, description: 'bot was blocked by the user' });
  assert.equal((await call(admin, 'POST', `/admin/conversations/${id}/messages`, { text: 'Вы тут?' })).status, 409);
  bot.call = ok;
  assert.deepEqual([(await inbox()).messages[0]!.text, (await inbox()).messages[0]!.status], ['Вы тут?', 'failed']);
});

test('скрытие: диалог пропадает из списка до следующего сообщения человека, скрытие отменяется', async () => {
  await db.execute(sql`truncate conversations cascade`);
  settings.adminIds = [70];
  const admin = tma(70, 'Админ');
  const one = async () => ((await (await call(admin, 'GET', '/admin/inbox')).json()) as InboxFeed).conversations[0]!;
  await handleUpdate(db, botMessage(71, 'Как записаться на покер?'));
  const { id } = await one();

  // Скрыли — диалог помечен и больше не ждёт нас; отмена возвращает его как был.
  const res = await call(admin, 'PATCH', `/admin/conversations/${id}`, { is_hidden: true });
  assert.equal(res.status, 200);
  let c = await one();
  assert.ok(c.hidden_at, 'скрыт');
  assert.equal(c.attention, null);
  assert.equal((await call(admin, 'POST', `/admin/actions/${(await lastAction())!.id}/undo`)).status, 201);
  c = await one();
  assert.deepEqual([c.hidden_at, c.attention], [null, 'Бот не ответил']);

  // Человек написал снова — диалог сам возвращается в список.
  await call(admin, 'PATCH', `/admin/conversations/${id}`, { is_hidden: true });
  assert.ok((await one()).hidden_at);
  await handleUpdate(db, botMessage(71, '/start'));
  assert.equal((await one()).hidden_at, null);
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
  assert.deepEqual(Object.keys((await inbox()).accounts[0]!).sort(), ['cold_today', 'created_at', 'daily_limit', 'id', 'label', 'last_error', 'phone', 'status']);

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

  // Тим набирает ещё одно сообщение — админка видит это в потоке /admin/live сразу, без опроса.
  const live = sseEvents((await call(admin, 'GET', '/admin/live')).body!);
  const next = async (name: string) => {
    for (;;) {
      const { value } = await live.next();
      if (value!.event === name) return JSON.parse(value!.data) as unknown;
    }
  };
  assert.deepEqual(await next('typing'), [], 'сразу — кто пишет сейчас');
  const typing = (body: object) => app.request('/internal/account-typing', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-collector-secret': 'collector-secret' }, body: JSON.stringify(body),
  });
  assert.equal((await typing({ account_id: account.id, peer_id: 555 })).status, 204);
  assert.deepEqual(await next('typing'), [{ conversation_id: id, who: 'user', agent: null, text: null }]);
  assert.equal((await typing({ account_id: account.id, peer_id: 556 })).status, 204, 'диалога нет — показывать негде, но и не ошибка');
  // Сообщение пришло — «печатает» снят, и лента перечитывается.
  assert.equal((await report({ ...incoming, text: 'И сколько стоит?' }, 'collector-secret')).status, 204);
  assert.deepEqual(await next('typing'), []);
  assert.equal(await next('changed'), null);
  await live.return(undefined);
  await db.delete(messages).where(eq(messages.text, 'И сколько стоит?'));
  feed = await inbox();
  sent.length = 0;
  // Пока вход в аккаунт не закончен, сборщик с него не шлёт: сообщение осталось бы в очереди, поэтому отказ.
  const early = await call(admin, 'POST', `/admin/conversations/${id}/messages`, { text: 'Каталог событий Дананга.' });
  assert.deepEqual([early.status, ((await early.json()) as { error: string }).error], [409, 'account_unavailable']);
  await db.update(tgAccounts).set({ status: 'active' }).where(eq(tgAccounts.id, account.id));
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

test('лимит аккаунта: первых сообщений за сутки не больше daily_limit, ответы без лимита', async () => {
  await db.execute(sql`truncate conversations, tg_accounts cascade`);
  settings.adminIds = [70];
  const admin = tma(70, 'Админ');
  const [account] = await db.insert(tgAccounts).values({ label: 'Аня', phone: '+84900000031', status: 'active' }).returning();
  assert.equal(account!.daily_limit, 20, 'по умолчанию');
  assert.equal((await call(admin, 'PATCH', `/admin/accounts/${account!.id}`, { daily_limit: -1 })).status, 400);
  const patched = (await (await call(admin, 'PATCH', `/admin/accounts/${account!.id}`, { daily_limit: 1 })).json()) as TgAccount;
  assert.deepEqual([patched.label, patched.daily_limit, patched.cold_today], ['Аня', 1, 0]);

  const dialog = async (peer_id: number) =>
    (await db.insert(conversations).values({ channel: 'account', account_id: account!.id, peer_id, peer_name: `Человек ${peer_id}` }).returning())[0]!.id;
  const send = (id: string, text: string) => call(admin, 'POST', `/admin/conversations/${id}/messages`, { text });
  const [first, second, wrote] = [await dialog(601), await dialog(602), await dialog(603)];
  await db.insert(messages).values({ conversation_id: wrote, direction: 'in', author: 'user', text: 'Привет, что за сервис?', status: 'received' });

  assert.equal((await send(first, 'Здравствуйте!')).status, 204);
  const blocked = await send(second, 'Здравствуйте!');
  assert.deepEqual([blocked.status, ((await blocked.json()) as { error: string }).error], [409, 'daily_limit']);
  assert.equal((await send(first, 'Напомню о себе')).status, 409, 'повтор без ответа — тоже первое сообщение');
  assert.equal((await send(wrote, 'Это каталог событий')).status, 204, 'человек написал сам — отвечаем без лимита');
  assert.equal((await send(wrote, 'И ещё')).status, 204);
  const [listed] = (await (await call(admin, 'GET', '/admin/inbox')).json() as InboxFeed).accounts;
  assert.deepEqual([listed!.cold_today, listed!.daily_limit], [1, 1]);

  // Человек ответил на первое сообщение — дальше с ним без лимита.
  await db.insert(messages).values({ conversation_id: first, direction: 'in', author: 'user', text: 'Да?', status: 'received' });
  assert.equal((await send(first, 'Рассказываю')).status, 204);
});

test('отзывы: запрос после события, оценка кнопкой, текст ответом, сводка организатору', async () => {
  const { event } = await newEvent(tma(80, 'Миша'));
  for (const id of [80, 81, 82]) await call(tma(id, `G${id}`), 'POST', `/events/${event.id}/rsvp`, { approval_status: 'approved' });
  await call(tma(84, 'G84'), 'POST', `/events/${event.id}/rsvp`, { approval_status: 'maybe' });
  await new Promise((r) => setTimeout(r, 100)); // уведомления о записи уходят с паузой — пусть не мешают
  const labels = () => sent.filter(([m]) => m === 'sendWidget').map(([, b]) => [b.chat_id, JSON.parse(b.public_data).l]).sort();
  const press = (id: number, data: string) => handleUpdate(db, { update_id: 1, callback_query: { id: 'q', from: { id, first_name: `G${id}` }, data } });

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
  await handleUpdate(db, botMessage(81, 'Было здорово, в субботу приду ещё', { reply_to_message: { message_id: row!.prompt_message_id } }));
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

test('охотник: старое сообщение из чата — черновик в личку, а не ответ в чат', async () => {
  await db.execute(sql`truncate conversations, tg_accounts cascade`);
  settings.adminIds = [70];
  settings.hunterUrl = 'http://hunter.test';
  settings.hunterUserIds = [];
  const ask = hunter.ask;
  let asked = '';
  hunter.ask = async (question) => ((asked = question), 'Привет! Видел, ты искала партнёра на бачату. В четверг в 20:00 социалка в Sol & Luna — скинуть подробности?');
  try {
    const sent_at = new Date(Date.now() - 3 * 86_400_000).toISOString();
    await recordLead(db, {
      chat: 'DaNang_girls', message_id: 9, url: 'https://t.me/DaNang_girls/9', author: { id: 600, name: 'Аня', username: 'anya_b' },
      text: 'Ищу партнёра на бачату по четвергам', context: [], sent_at, signal: 'seek',
    });
    assert.match(asked, /^Личное сообщение\. Человек писал в чате DaNang_girls 3 дн\. назад\.[\s\S]*Ищет компанию \(Аня\):\nИщу партнёра/);
    const feed = (await (await call(tma(70, 'Админ'), 'GET', '/admin/inbox')).json()) as InboxFeed;
    assert.deepEqual(feed.conversations.map((c) => [c.channel, c.peer_id, c.attention]), [['account', 600, 'Черновик в личку']]);
    const draft = feed.messages.find((m) => m.status === 'draft')!;
    assert.deepEqual(draft.meta, { reason: 'Писал в чате DaNang_girls 3 дн. назад', source_url: 'https://t.me/DaNang_girls/9' }); // без reply_to — уйдёт в личку
  } finally {
    hunter.ask = ask;
    settings.hunterUrl = '';
  }
});

test('выбор аккаунта: сообщение и черновик уходят с выбранного аккаунта, диалог переходит на него', async () => {
  await db.execute(sql`truncate conversations, tg_accounts cascade`);
  settings.adminIds = [70];
  const admin = tma(70, 'Админ');
  const [blocked, working, away] = await db.insert(tgAccounts).values([
    { label: 'Заблокирован', phone: '+84900000041', status: 'active' },
    { label: 'Рабочий', phone: '+84900000042', status: 'active' },
    { label: 'Не вошёл', phone: '+84900000043', status: 'login_code' },
  ]).returning();
  const [conversation] = await db.insert(conversations).values({ channel: 'account', account_id: blocked!.id, peer_id: 9500, peer_name: 'Даша' }).returning();
  const [draft] = await db.insert(messages).values({
    conversation_id: conversation!.id, direction: 'out', author: 'agent:hunter', text: 'Сегодня бачата', status: 'draft', meta: { reason: 'Вопрос в чате' },
  }).returning();
  const state = async () => {
    const feed = (await (await call(admin, 'GET', '/admin/inbox')).json()) as InboxFeed;
    return [feed.conversations[0]!.account_id, ...feed.messages.map((m) => [m.status, m.meta?.account_id])];
  };
  const refused = async (path: string, body: object) => {
    const res = await call(admin, 'POST', path, body);
    return [res.status, ((await res.json()) as { error: string }).error];
  };
  const sendPath = `/admin/messages/${draft!.id}/send`;

  // Не вошедший и несуществующий аккаунт выбрать нельзя; диалог остаётся на прежнем.
  assert.equal((await call(admin, 'POST', sendPath, { account_id: 'не uuid' })).status, 400);
  assert.deepEqual(await refused(sendPath, { account_id: away!.id }), [409, 'account_unavailable']);
  assert.deepEqual(await refused(sendPath, { account_id: crypto.randomUUID() }), [409, 'account_unavailable']);
  assert.deepEqual(await state(), [blocked!.id, ['draft', undefined]]);

  // Черновик охотника — с рабочего аккаунта: диалог переходит на него, причина черновика сохраняется.
  assert.equal((await call(admin, 'POST', sendPath, { account_id: working!.id })).status, 204);
  assert.deepEqual(await state(), [working!.id, ['queued', working!.id]]);
  const [queued] = await db.select().from(messages).where(eq(messages.id, draft!.id));
  assert.equal(queued!.meta?.reason, 'Вопрос в чате');

  // Своё сообщение: без выбора — с аккаунта диалога, с выбором — диалог переходит обратно; у сообщения остаётся свой аккаунт.
  const messagesPath = `/admin/conversations/${conversation!.id}/messages`;
  assert.equal((await call(admin, 'POST', messagesPath, { text: 'Придёте?' })).status, 204);
  assert.equal((await call(admin, 'POST', messagesPath, { text: 'Пишу с другого', account_id: blocked!.id })).status, 204);
  assert.deepEqual(await state(), [blocked!.id, ['queued', blocked!.id], ['queued', working!.id], ['queued', working!.id]]);
  assert.deepEqual(await refused(messagesPath, { text: 'Вы тут?', account_id: away!.id }), [409, 'account_unavailable']);

  // Аккаунт диалога удалили — без выбора сообщение уходит с первого рабочего.
  await db.delete(tgAccounts).where(eq(tgAccounts.id, blocked!.id));
  assert.equal((await call(admin, 'POST', messagesPath, { text: 'Мы снова здесь' })).status, 204);
  assert.equal((await state())[0], working!.id);
  // Рабочих аккаунтов нет — отправлять не с чего.
  await db.delete(tgAccounts).where(eq(tgAccounts.id, working!.id));
  assert.deepEqual(await refused(messagesPath, { text: 'Вы тут?' }), [409, 'no_account']);
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

  // Человек ответил на наш ответ в чате — охотник продолжает разговор: черновик по всей переписке, ответ уйдёт в тот же чат.
  const report = (peer: { id: number; name: string; username: string | null }, text: string, reply_to?: { chat: string; message_id: number }) =>
    app.request('/internal/account-message', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-collector-secret': 'collector-secret' },
      body: JSON.stringify({ account_id: account!.id, peer, direction: 'in', text, reply_to }),
    });
  const waitDraft = async () => {
    for (let i = 0; i < 50; i++) {
      const found = (await inbox()).messages.find((m) => m.status === 'draft');
      if (found) return found;
      await new Promise((r) => setTimeout(r, 20));
    }
    return assert.fail('черновик ответа не появился');
  };
  const reply = hunter.reply;
  let history: { role: string; content: string }[] = [];
  hunter.reply = async (turns) => ((history = turns), parseSupportReply('150k, записаться можно на странице:\nhttps://yaswami.com/e/x'));
  assert.equal((await report(lead.author, 'А сколько стоит?', { chat: 'danang_chat', message_id: 7 })).status, 204);
  const next = await waitDraft();
  assert.deepEqual([next.author, next.text, next.meta], ['agent:hunter', '150k, записаться можно на странице:\nhttps://yaswami.com/e/x', { reason: 'Ответ в чат', reply_to: { chat: 'danang_chat', message_id: 7 } }]);
  assert.equal((await inbox()).conversations[0]!.attention, 'Черновик ответа в чат');
  assert.match(history[0]!.content, /ещё не заходил/);
  assert.deepEqual(history.slice(1).map((t) => [t.role, t.content]), [
    ['user', '[чат danang_chat] Куда сегодня сходить потанцевать?'], ['assistant', 'Сегодня бачата в 19:00'], ['user', '[чат danang_chat] А сколько стоит?'],
  ]);
  // Написал в личку — ответ тоже в личку. Чужой человек, ответивший нашему аккаунту в чате, в переписку не попадает.
  assert.equal((await report(lead.author, 'А где это?')).status, 204);
  for (let i = 0; i < 50 && (await inbox()).messages.find((m) => m.status === 'draft')?.id === next.id; i++) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual((await waitDraft()).meta, { reason: 'Ответ человеку' });
  await report({ id: 999, name: 'Прохожий', username: null }, 'вы кто?', { chat: 'danang_chat', message_id: 8 });
  assert.equal((await inbox()).conversations.length, 1);
  await call(admin, 'DELETE', `/admin/messages/${(await waitDraft()).id}`);
  hunter.reply = reply;

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
  assert.ok((await rest('/admin/users')).some((u: any) => u.id === 81), 'без запроса — список');
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

// Операции команды: инструмент MCP ↔ маршрут REST. Изменяющие из них проверяет тест журнала ниже.
const ADMIN_PAIRS: Record<string, string> = {
  admin_overview_get: 'GET /admin/overview',
  admin_conversations_list: 'GET /admin/inbox',
  admin_conversations_get: 'GET /admin/conversations/:id/messages',
  admin_conversations_update: 'PATCH /admin/conversations/:id',
  admin_messages_send: 'POST /admin/conversations/:id/messages',
  admin_drafts_send: 'POST /admin/messages/:id/send',
  admin_drafts_update: 'PATCH /admin/messages/:id',
  admin_drafts_reject: 'DELETE /admin/messages/:id',
  admin_accounts_list: 'GET /admin/accounts',
  admin_accounts_create: 'POST /admin/accounts',
  admin_accounts_update: 'PATCH /admin/accounts/:id',
  admin_accounts_delete: 'DELETE /admin/accounts/:id',
  admin_events_list: 'GET /admin/events',
  admin_events_create: 'POST /admin/events',
  admin_events_get: 'GET /admin/events/:id',
  admin_events_update: 'PATCH /admin/events/:id',
  admin_events_delete: 'DELETE /admin/events/:id',
  admin_events_guests_list: 'GET /admin/events/:id/guests',
  admin_events_guests_update: 'PUT /admin/events/:id/guests/:user_id',
  admin_events_guests_remove: 'DELETE /admin/events/:id/guests/:user_id',
  admin_events_ticket_types_create: 'POST /admin/events/:id/ticket-types',
  admin_events_ticket_types_update: 'PATCH /admin/ticket-types/:id',
  admin_events_ticket_types_delete: 'DELETE /admin/ticket-types/:id',
  admin_events_feedback_list: 'GET /admin/events/:id/feedback',
  admin_events_feedback_delete: 'DELETE /admin/events/:id/feedback/:user_id',
  admin_collected_events_list: 'GET /admin/collected-events',
  admin_collected_events_get: 'GET /admin/collected-events/:id',
  admin_collected_events_update: 'PATCH /admin/collected-events/:id',
  admin_collected_events_delete: 'DELETE /admin/collected-events/:id',
  admin_collected_events_redo: 'POST /admin/collected-events/:id/redo',
  admin_sources_list: 'GET /admin/sources',
  admin_sources_create: 'POST /admin/sources',
  admin_sources_update: 'PATCH /admin/sources/:channel',
  admin_cities_list: 'GET /admin/cities',
  admin_cities_create: 'POST /admin/cities',
  admin_cities_update: 'PATCH /admin/cities/:id',
  admin_covers_list: 'GET /admin/covers',
  admin_covers_set: 'POST /admin/covers/:id',
  admin_videos_request: 'POST /admin/videos/:id',
  admin_hosts_list: 'GET /admin/hosts',
  admin_hosts_create: 'POST /admin/hosts',
  admin_hosts_get: 'GET /admin/hosts/:id',
  admin_hosts_update: 'PATCH /admin/hosts/:id',
  admin_hosts_delete: 'DELETE /admin/hosts/:id',
  admin_users_search: 'GET /admin/users',
  admin_users_get: 'GET /admin/users/:id',
  admin_users_update: 'PATCH /admin/users/:id',
  admin_users_delete: 'DELETE /admin/users/:id',
  admin_users_tokens_revoke: 'DELETE /admin/users/:id/tokens',
  admin_contacts_list: 'GET /admin/contacts',
  admin_contacts_remove: 'DELETE /admin/contacts/:id',
  admin_actions_list: 'GET /admin/actions',
  admin_actions_get: 'GET /admin/actions/:id',
  admin_actions_undo: 'POST /admin/actions/:id/undo',
};

// Правило «операция = сервис + REST + MCP» (docs/agents/api.md). Добавил инструмент или маршрут — допиши строку сюда:
// пару или исключение с причиной в docs/agents/api.md.
test('источники: команда добавляет и выключает, канал организатора виден со ссылкой на него', async () => {
  settings.adminIds = [70];
  const admin = tma(70, 'Админ');
  const tool = async (name: string, args: object) =>
    JSON.parse(((await (await call(admin, 'POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).json()) as { result: any }).result.content[0].text);
  await db.delete(sources);
  assert.equal((await call(tma(71, 'Аня'), 'GET', '/admin/sources')).status, 403);
  // Ссылка t.me сводится к username; тот же канал в другом регистре — уже есть.
  const res = await call(admin, 'POST', '/admin/sources', { channel: 'https://t.me/Danang_Yoga' });
  assert.equal(res.status, 201);
  assert.deepEqual(((await res.json()) as AdminSource).channel, 'Danang_Yoga');
  assert.deepEqual(await tool('admin_sources_create', { channel: '@danang_yoga' }), { error: 'source_exists' });
  assert.equal((await call(admin, 'POST', '/admin/sources', { channel: 'not a channel' })).status, 400);
  // Канал организатора добавляет сборщик (apps/collector): здесь — строкой, как он.
  const [h] = await db.insert(hosts).values({ telegram_id: 9400, username: 'lena_tea', name: 'Лена', channel: 'lena_tea_club' }).returning();
  await db.insert(sources).values({ channel: 'lena_tea_club', host_id: h!.id });
  const at = new Date(Date.now() + 86_400_000);
  await db.insert(collectedEvents).values({
    external_id: 'telegram:lena_tea_club/1#0', channel: 'lena_tea_club', starts_at: at, signup_url: '', announcement: { url: 'https://t.me/lena_tea_club/1' },
    event: { title: 'Чай', description: '', starts_at: at.toISOString(), ends_at: null, place: null, address: null, price: null, tags: [], telegram_username: 'lena_tea', whatsapp_phone: null, url: null },
  });
  const list = (await (await call(admin, 'GET', '/admin/sources')).json()) as AdminSource[];
  assert.deepEqual(list.map((x) => [x.channel, x.host?.username ?? null, x.events_count, x.enabled]), [['lena_tea_club', 'lena_tea', 1, true], ['Danang_Yoga', null, 0, true]]);
  // Выключить: канал оказался чужим.
  assert.equal(((await tool('admin_sources_update', { channel: 'LENA_TEA_CLUB', enabled: false })) as AdminSource).enabled, false);
  assert.equal(((await (await call(admin, 'GET', '/admin/sources')).json()) as AdminSource[])[0]!.enabled, false);
  // Через журнал: строка — по каналу так, как он записан, и выключение отменяется.
  const off = (await lastAction())!;
  assert.deepEqual([off.action, off.entity, off.entity_id], ['admin_sources_update', 'source', 'lena_tea_club']);
  assert.equal((await call(admin, 'POST', `/admin/actions/${off.id}/undo`)).status, 201);
  assert.equal(((await (await call(admin, 'GET', '/admin/sources')).json()) as AdminSource[])[0]!.enabled, true);
  assert.equal((await call(admin, 'PATCH', '/admin/sources/nobody_here', { enabled: true })).status, 404);

  // Организатор по username: заготовка без telegram_id, её сразу можно указать у источника.
  const made = await call(admin, 'POST', '/admin/hosts', { username: 'https://t.me/Dato_Banya' });
  assert.equal(made.status, 201);
  const stub = (await made.json()) as Host;
  assert.deepEqual([stub.username, stub.telegram_id, stub.status], ['dato_banya', null, 'pending']);
  assert.deepEqual(await tool('admin_hosts_create', { username: '@dato_banya' }), { error: 'host_exists' });
  assert.equal((await call(admin, 'POST', '/admin/hosts', { username: 'нет' })).status, 400);
  const bound = (await tool('admin_sources_update', { channel: 'danang_yoga', host_id: stub.id })) as AdminSource;
  assert.deepEqual([bound.host?.id, bound.host?.username, bound.enabled], [stub.id, 'dato_banya', true], 'организатор указан, включённость не тронута');
  assert.deepEqual(await (await call(admin, 'PATCH', '/admin/sources/danang_yoga', { host_id: randomUUID() })).json(), { error: 'host_not_found' });

  // Сборщик (apps/collector/src/store.mjs) находит человека в Telegram: заготовка заполняется на месте, источник остаётся за ней.
  const { createStore } = await import(new URL('../../collector/src/store.mjs', import.meta.url).href);
  const store = createStore(url.href);
  try {
    assert.deepEqual(await store.requestedHosts(), ['dato_banya']);
    await store.saveHost({ telegram_id: 9401, username: 'dato_banya', name: 'Дато', bio: null, channel: null, summary: 'Баня.' });
    const [filled] = await db.select().from(hosts).where(eq(hosts.id, stub.id));
    assert.deepEqual([filled!.telegram_id, filled!.name, filled!.summary], [9401, 'Дато', 'Баня.']);
    // Человек уже есть под другим username: источник заготовки переходит к его строке, заготовка удаляется.
    const again = (await (await call(admin, 'POST', '/admin/hosts', { username: 'dato_new' })).json()) as Host;
    await call(admin, 'PATCH', '/admin/sources/danang_yoga', { host_id: again.id });
    await store.saveHost({ telegram_id: 9401, username: 'dato_new', name: 'Дато', bio: null, channel: null, summary: null });
    assert.deepEqual((await db.select().from(hosts).where(eq(hosts.telegram_id, 9401))).map((x) => [x.id, x.username]), [[stub.id, 'dato_new']]);
    assert.equal((await db.select().from(hosts).where(eq(hosts.id, again.id))).length, 0);
    assert.equal((await db.select().from(sources).where(eq(sources.channel, 'Danang_Yoga')))[0]!.host_id, stub.id);
    // Под username никого нет: заготовка отклонена с пояснением и больше не в очереди.
    await call(admin, 'POST', '/admin/hosts', { username: 'nobody_such' });
    await store.rejectRequestedHost('nobody_such');
    assert.deepEqual(await store.requestedHosts(), []);
    assert.equal((await db.select().from(hosts).where(eq(hosts.username, 'nobody_such')))[0]!.status, 'rejected');
  } finally {
    await store.end();
  }
});

test('города: всё прежнее — Дананг; новый город получает свои источники, события и организаторов, витрина его не показывает', async () => {
  settings.adminIds = [70];
  const admin = tma(70, 'Админ');
  const tool = async (name: string, args: object) =>
    JSON.parse(((await (await call(admin, 'POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).json()) as { result: any }).result.content[0].text);
  const feed = async () => ((await (await call(admin, 'GET', '/collected-events')).json()) as CollectedEventItem[]).map((e) => e.id);
  assert.equal((await call(tma(71, 'Аня'), 'GET', '/admin/cities')).status, 403);
  assert.deepEqual(((await (await call(admin, 'GET', '/admin/cities')).json()) as City[]).map((c) => [c.id, c.name, c.timezone]), [['danang', 'Дананг', 'Asia/Ho_Chi_Minh']]);

  const made = await call(admin, 'POST', '/admin/cities', { id: 'tbilisi', name: 'Тбилиси', timezone: 'Asia/Tbilisi' });
  assert.equal(made.status, 201);
  assert.deepEqual(await tool('admin_cities_create', { id: 'tbilisi', name: 'Ещё раз', timezone: 'Asia/Tbilisi' }), { error: 'city_exists' });
  assert.equal((await call(admin, 'POST', '/admin/cities', { id: 'Тбилиси', name: 'Тбилиси', timezone: 'Asia/Tbilisi' })).status, 400);
  assert.equal((await call(admin, 'POST', '/admin/cities', { id: 'batumi', name: 'Батуми', timezone: 'Asia/Nowhere' })).status, 400);
  assert.equal(((await tool('admin_cities_update', { city_id: 'tbilisi', name: 'Тифлис' })) as City).name, 'Тифлис');
  assert.equal((await call(admin, 'PATCH', '/admin/cities/nowhere', { name: 'Нигде' })).status, 404);

  // Источник: без города — Дананг, с городом — он; неизвестный город — отказ, а не сбой.
  await db.delete(sources);
  assert.equal(((await (await call(admin, 'POST', '/admin/sources', { channel: 'danang_chat' })).json()) as AdminSource).city_id, 'danang');
  assert.equal(((await tool('admin_sources_create', { channel: 'tbilisi_chat', city_id: 'tbilisi' })) as AdminSource).city_id, 'tbilisi');
  assert.deepEqual(await tool('admin_sources_create', { channel: 'nowhere_chat', city_id: 'nowhere' }), { error: 'city_not_found' });
  assert.equal(((await (await call(admin, 'PATCH', '/admin/sources/danang_chat', { city_id: 'tbilisi' })).json()) as AdminSource).city_id, 'tbilisi');
  assert.deepEqual(await (await call(admin, 'PATCH', '/admin/sources/danang_chat', { city_id: 'nowhere' })).json(), { error: 'city_not_found' });

  // Сборщик (apps/collector/src/store.mjs): источник отдаёт город и пояс, событие из него получает этот город.
  const { createStore } = await import(new URL('../../collector/src/store.mjs', import.meta.url).href);
  const store = createStore(url.href);
  const at = new Date(Date.now() + 86_400_000);
  const event = { title: 'Хинкали', description: '', starts_at: at.toISOString(), ends_at: null, place: null, address: null, price: null, tags: [], telegram_username: 'gio_host', whatsapp_phone: null, url: null };
  try {
    const [src] = (await store.sources()).filter((x: { channel: string }) => x.channel === 'tbilisi_chat');
    assert.deepEqual([src.city_id, src.city, src.timezone], ['tbilisi', 'Тифлис', 'Asia/Tbilisi']);
    await store.upsert({ external_id: 'telegram:tbilisi_chat/1#0', channel: 'tbilisi_chat', city_id: src.city_id, announcement: { url: 'https://t.me/tbilisi_chat/1' }, event, signup_url: '' });
    await db.update(collectedEvents).set({ status: 'published' }).where(eq(collectedEvents.external_id, 'telegram:tbilisi_chat/1#0'));
    // Организатор, найденный по событию, получает его город; его канал становится источником того же города.
    assert.deepEqual([...(await store.unprofiled())].map((r: { username: string; city_id: string }) => [r.username, r.city_id]), [['gio_host', 'tbilisi']]);
    await store.saveHost({ telegram_id: 9500, username: 'gio_host', name: 'Гио', bio: null, channel: 'gio_supra', summary: null, city_id: 'tbilisi' });
    await store.adoptHostChannels(5);
    assert.equal((await db.select().from(sources).where(eq(sources.channel, 'gio_supra')))[0]!.city_id, 'tbilisi');
  } finally {
    await store.end();
  }
  const listed = ((await (await call(admin, 'GET', '/admin/collected-events')).json()) as AdminCollectedEvent[]).find((e) => e.id === 'tbilisi_chat-1-0');
  assert.equal(listed!.city_id, 'tbilisi');
  // Витрина одна и показывает первый город: событие и организатор другого города в неё не попадают.
  assert.ok(!(await feed()).includes('tbilisi_chat-1-0'));
  assert.ok(!((await (await call(admin, 'GET', '/hosts')).json()) as HostListItem[]).some((h) => h.username === 'gio_host'));
  assert.equal(((await tool('admin_collected_events_update', { collected_event_id: 'tbilisi_chat-1-0', city_id: 'danang' })) as AdminCollectedEvent).city_id, 'danang');
  assert.ok((await feed()).includes('tbilisi_chat-1-0'));
  assert.deepEqual(await tool('admin_collected_events_update', { collected_event_id: 'tbilisi_chat-1-0', city_id: 'nowhere' }), { error: 'city_not_found' });

  // Организатор и событие Ясвами: город указывает команда.
  const [gio] = await db.select().from(hosts).where(eq(hosts.username, 'gio_host'));
  assert.equal(((await (await call(admin, 'PATCH', `/admin/hosts/${gio!.id}`, { city_id: 'danang' })).json()) as Host).city_id, 'danang');
  assert.equal(((await tool('admin_hosts_create', { username: 'nino_wine', city_id: 'tbilisi' })) as Host).city_id, 'tbilisi');
  // Услуги (Practice) живут в профиле мастера и идут за его городом: мастер другого города во вкладку «Услуги» не попадает.
  const practices = [{ title: 'Дегустация', topic: Object.keys(TOPIC_GUIDES)[0]!, description: null, price: null }];
  await db.update(hosts).set({ status: 'published', practices }).where(eq(hosts.username, 'nino_wine'));
  const services = async () => ((await (await call(admin, 'GET', '/hosts')).json()) as HostListItem[]).filter((h) => h.username === 'nino_wine').length;
  assert.equal(await services(), 0);
  await db.update(hosts).set({ city_id: 'danang' }).where(eq(hosts.username, 'nino_wine'));
  assert.equal(await services(), 1);
  const input = { user_id: 70, kind: 'o', name: 'Супра', start_at: '2027-01-01T19:00:00+04:00', timezone: 'Asia/Tbilisi' };
  const supra = (await (await call(admin, 'POST', '/admin/events', { ...input, city_id: 'tbilisi' })).json()) as EventView;
  assert.equal(supra.event.city_id, 'tbilisi');
  assert.equal(((await tool('admin_events_update', { event_id: supra.event.id, city_id: 'danang' })) as EventView).event.city_id, 'danang');
  assert.deepEqual(await (await call(admin, 'POST', '/admin/events', { ...input, city_id: 'nowhere' })).json(), { error: 'city_not_found' });
  // Организатор сам город не выбирает: его событие получает город по умолчанию, лишнее поле отбрасывается.
  const featuresOn = settings.featuresOn;
  settings.featuresOn = ['event_create'];
  const own = (await (await call(admin, 'POST', '/events', { kind: 'o', name: 'Своё', start_at: '2027-01-02T19:00:00+07:00', timezone: 'Asia/Ho_Chi_Minh', city_id: 'tbilisi' })).json()) as EventView;
  assert.equal(own.event.city_id, 'danang');
  settings.featuresOn = featuresOn;
});

test('парность: у каждого инструмента MCP есть маршрут REST и наоборот', async () => {
  const PAIRS: Record<string, string> = {
    collected_events_list: 'GET /collected-events',
    collected_events_get: 'GET /collected-events/:id',
    hosts_list: 'GET /hosts',
    hosts_get: 'GET /hosts/:id',
    hosts_practices_signup: 'POST /hosts/:id/practices/signup',
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
    ...ADMIN_PAIRS,
  };
  const MCP_ONLY = ['person_events_list', 'person_events_get', 'person_events_create', 'person_events_update'];
  const REST_ONLY = [
    'GET /health', 'GET /config', 'GET /photos/:id', 'POST /telegram/webhook', 'POST /internal/account-message', 'POST /internal/account-typing', 'POST /internal/lead', 'GET /admin/live',
    'GET /auth/telegram/login', 'GET /auth/telegram/callback', 'POST /auth/logout', 'POST /tokens', 'DELETE /tokens',
    'POST /collected-events/:id/visit', 'POST /events/:id/visit',
    'POST /admin/accounts/:id/login',
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

// --- Журнал действий команды и отмена (audit.ts, ADR-0004)

const ADMIN = 70;
const mcpCall = async (auth: string, name: string, args: object) => {
  const res = await call(auth, 'POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  const { result } = (await res.json()) as { result: { isError?: boolean; content: { text: string }[] } };
  return { error: !!result.isError, body: JSON.parse(result.content[0]!.text) };
};
const lastAction = async () => (await db.select().from(adminActions).orderBy(desc(adminActions.created_at)).limit(1))[0];

/** Свой маленький мир на каждый вызов: организатор, гость, событие с двумя типами, отзыв, каталог, профиль, аккаунт, диалог. */
let worlds = 0;
async function world() {
  const n = ++worlds;
  const base = 600_000 + n * 10;
  const [hostId, guestId, otherId] = [base + 1, base + 2, base + 3];
  await db.insert(users).values([hostId, guestId, otherId].map((id) => ({ id, first_name: `U${id}`, username: `u${id}`, lang: 'ru', timezone: 'UTC' })));
  const eventId = `e_audit${n}`;
  await db.insert(eventsTable).values({ id: eventId, user_id: hostId, kind: 'o', name: 'Событие', start_at: new Date(Date.now() + 86_400_000), timezone: 'UTC', status: 'published', allow_plus_one: true });
  const [t1, t2] = await db.insert(ticketTypes).values([{ event_id: eventId, name: 'A' }, { event_id: eventId, name: 'B', position: 1 }]).returning();
  await db.insert(guests).values({ event_id: eventId, user_id: guestId, approval_status: 'approved', event_ticket_type_id: t1!.id, registered_at: new Date() });
  await db.insert(eventFeedback).values({ event_id: eventId, user_id: guestId, rating: 5, comment: 'Отлично' });
  const [contact] = await db.insert(contacts).values({ host_user_id: hostId, user_id: guestId }).returning();
  const starts = new Date(Date.now() + 86_400_000);
  await db.insert(collectedEvents).values({
    external_id: `telegram:auditchan/${n}#0`, channel: 'auditchan', status: 'approved', starts_at: starts, signup_url: '', announcement: { url: `https://t.me/auditchan/${n}` },
    event: { title: 'Баня', description: '', starts_at: starts.toISOString(), ends_at: null, place: null, address: null, price: null, tags: [], telegram_username: null, whatsapp_phone: null, url: null },
  });
  const [profile] = await db.insert(hosts).values({ telegram_id: base + 5, username: `host${n}`, name: 'Орг' }).returning();
  const [account] = await db.insert(tgAccounts).values({ label: 'Основной', phone: `+7900${base}` }).returning();
  const source = `auditsrc${n}`;
  await db.insert(sources).values({ channel: source });
  const [conversation] = await db.insert(conversations).values({ channel: 'bot', peer_id: guestId, peer_name: 'Гость' }).returning();
  const [draft] = await db.insert(messages).values({ conversation_id: conversation!.id, direction: 'out', author: 'agent:host', text: 'Привет', status: 'draft' }).returning();
  return {
    n, hostId, guestId, otherId, eventId, t1: t1!.id, t2: t2!.id, slug: `auditchan-${n}-0`, profileId: profile!.id, accountId: account!.id,
    conversationId: conversation!.id, draftId: draft!.id, contactId: contact!.id, source,
  };
}
type World = Awaited<ReturnType<typeof world>>;
interface Case { args: object; params?: Record<string, string | number>; body?: object; entity_id: string | ((res: any) => string) }

// Каждое изменяющее действие команды: как вызвать его в MCP и в REST и чего касается строка журнала.
const CASES: Record<string, (w: World) => Case | Promise<Case>> = {
  admin_events_create: (w) => {
    const input = { user_id: w.otherId, kind: 'o', name: 'Новое', start_at: '2027-01-01T10:00:00+07:00', timezone: 'Asia/Ho_Chi_Minh' };
    return { args: input, body: input, entity_id: (r) => r.event.id };
  },
  admin_events_update: (w) => ({ args: { event_id: w.eventId, name: 'Другое' }, params: { id: w.eventId }, body: { name: 'Другое' }, entity_id: w.eventId }),
  admin_events_delete: (w) => ({ args: { event_id: w.eventId }, params: { id: w.eventId }, entity_id: w.eventId }),
  admin_events_guests_update: (w) => ({
    args: { event_id: w.eventId, user_id: w.otherId, approval_status: 'approved', event_ticket_type_id: w.t1, plus_ones: 1 }, params: { id: w.eventId, user_id: w.otherId },
    body: { approval_status: 'approved', event_ticket_type_id: w.t1, plus_ones: 1 }, entity_id: w.eventId,
  }),
  admin_events_guests_remove: (w) => ({ args: { event_id: w.eventId, user_id: w.guestId }, params: { id: w.eventId, user_id: w.guestId }, entity_id: w.eventId }),
  admin_events_ticket_types_create: (w) => ({ args: { event_id: w.eventId, name: 'C' }, params: { id: w.eventId }, body: { name: 'C' }, entity_id: w.eventId }),
  admin_events_ticket_types_update: (w) => ({ args: { event_ticket_type_id: w.t2, name: 'BB' }, params: { id: w.t2 }, body: { name: 'BB' }, entity_id: w.eventId }),
  admin_events_ticket_types_delete: (w) => ({ args: { event_ticket_type_id: w.t2 }, params: { id: w.t2 }, entity_id: w.eventId }),
  admin_events_feedback_delete: (w) => ({ args: { event_id: w.eventId, user_id: w.guestId }, params: { id: w.eventId, user_id: w.guestId }, entity_id: w.eventId }),
  admin_collected_events_update: (w) => ({ args: { collected_event_id: w.slug, title: 'Баня на углях' }, params: { id: w.slug }, body: { title: 'Баня на углях' }, entity_id: w.slug }),
  admin_collected_events_delete: (w) => ({ args: { collected_event_id: w.slug }, params: { id: w.slug }, entity_id: w.slug }),
  admin_collected_events_redo: (w) => ({ args: { collected_event_id: w.slug }, params: { id: w.slug }, entity_id: w.slug }),
  admin_covers_set: (w) => ({ args: { id: w.slug }, params: { id: w.slug }, body: {}, entity_id: w.slug }),
  admin_videos_request: (w) => ({ args: { id: w.slug }, params: { id: w.slug }, entity_id: w.slug }),
  admin_hosts_create: (w) => ({ args: { username: `@newhost${w.n}` }, body: { username: `t.me/newhost${w.n}` }, entity_id: (r) => r.id }),
  admin_hosts_update: (w) => ({ args: { host_id: w.profileId, name: 'Игорь' }, params: { id: w.profileId }, body: { name: 'Игорь' }, entity_id: w.profileId }),
  admin_hosts_delete: (w) => ({ args: { host_id: w.profileId }, params: { id: w.profileId }, entity_id: w.profileId }),
  admin_users_update: (w) => ({ args: { user_id: w.otherId, first_name: 'Иван' }, params: { id: w.otherId }, body: { first_name: 'Иван' }, entity_id: String(w.otherId) }),
  admin_users_delete: (w) => ({ args: { user_id: w.guestId }, params: { id: w.guestId }, entity_id: String(w.guestId) }),
  admin_users_tokens_revoke: (w) => ({ args: { user_id: w.otherId }, params: { id: w.otherId }, entity_id: String(w.otherId) }),
  admin_sources_create: (w) => ({ args: { channel: `@newsrc${w.n}` }, body: { channel: `t.me/newsrc${w.n}` }, entity_id: (r) => r.channel }),
  admin_sources_update: (w) => ({ args: { channel: w.source.toUpperCase(), enabled: false }, params: { channel: w.source }, body: { enabled: false }, entity_id: w.source }),
  admin_cities_create: (w) => {
    const input = { id: `city${w.n}`, name: 'Город', timezone: 'Asia/Tbilisi' };
    return { args: input, body: input, entity_id: input.id };
  },
  admin_cities_update: () => ({ args: { city_id: 'danang', name: 'Дананг' }, params: { id: 'danang' }, body: { name: 'Дананг' }, entity_id: 'danang' }),
  admin_contacts_remove: (w) => ({ args: { contact_id: w.contactId }, params: { id: w.contactId }, entity_id: w.contactId }),
  admin_accounts_create: (w) => {
    const input = { label: 'Второй', phone: `+7911${w.hostId}` };
    return { args: input, body: input, entity_id: (r) => r.id };
  },
  admin_accounts_update: (w) => ({ args: { account_id: w.accountId, label: 'Запасной' }, params: { id: w.accountId }, body: { label: 'Запасной' }, entity_id: w.accountId }),
  admin_accounts_delete: (w) => ({ args: { account_id: w.accountId }, params: { id: w.accountId }, entity_id: w.accountId }),
  admin_conversations_update: (w) => ({ args: { conversation_id: w.conversationId, mode: 'human' }, params: { id: w.conversationId }, body: { mode: 'human' }, entity_id: w.conversationId }),
  admin_messages_send: (w) => ({ args: { conversation_id: w.conversationId, text: 'Здравствуйте' }, params: { id: w.conversationId }, body: { text: 'Здравствуйте' }, entity_id: w.conversationId }),
  admin_drafts_send: (w) => ({ args: { message_id: w.draftId }, params: { id: w.draftId }, body: {}, entity_id: w.draftId }),
  admin_drafts_update: (w) => ({ args: { message_id: w.draftId, text: 'Добрый день' }, params: { id: w.draftId }, body: { text: 'Добрый день' }, entity_id: w.draftId }),
  admin_drafts_reject: (w) => ({ args: { message_id: w.draftId }, params: { id: w.draftId }, entity_id: w.draftId }),
  admin_actions_undo: async (w) => {
    assert.equal((await call(tma(ADMIN, 'Админ'), 'PATCH', `/admin/events/${w.eventId}`, { name: 'Для отмены' })).status, 200);
    const { id } = (await lastAction())!;
    return { args: { action_id: id }, params: { id }, entity_id: w.eventId };
  },
};

test('журнал: каждое изменяющее действие команды оставляет запись — кто, откуда, что и с чем', async () => {
  settings.adminIds = [ADMIN];
  settings.illustratorUrl = 'http://illustrator.test';
  settings.illustratorDailyLimit = 1000;
  const draw = illustrator.ask;
  illustrator.ask = async () => null;
  const admin = tma(ADMIN, 'Админ');

  // Список случаев сверяется со входами: новая изменяющая операция без строки здесь роняет тест.
  const listed = await call(admin, 'POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const tools = ((await listed.json()) as { result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] } }).result.tools;
  assert.deepEqual(Object.keys(CASES).sort(), tools.filter((t) => t.name.startsWith('admin_') && !t.annotations.readOnlyHint).map((t) => t.name).sort());
  const restWrites = [...new Set(app.routes.filter((r) => r.path.startsWith('/admin') && r.method !== 'GET' && r.method !== 'ALL').map((r) => `${r.method} ${r.path}`))];
  assert.deepEqual(restWrites.sort(), [...Object.keys(CASES).map((t) => ADMIN_PAIRS[t]!), 'POST /admin/accounts/:id/login'].sort());

  for (const [name, make] of Object.entries(CASES)) {
    const viaMcp = await make(await world());
    const done = await mcpCall(admin, name, viaMcp.args);
    assert.equal(done.error, false, `${name} (MCP): ${JSON.stringify(done.body)}`);
    let row = await lastAction();
    const mcpId = typeof viaMcp.entity_id === 'string' ? viaMcp.entity_id : viaMcp.entity_id(done.body);
    assert.deepEqual([row!.actor_id, row!.via, row!.action, row!.entity_id], [ADMIN, 'mcp', name, mcpId], name);

    const viaRest = await make(await world());
    const [method, template] = ADMIN_PAIRS[name]!.split(' ') as [string, string];
    const path = template.replace(/:(\w+)/g, (_m, key: string) => encodeURIComponent(String(viaRest.params![key])));
    const res = await call(admin, method, path, viaRest.body);
    assert.ok(res.ok, `${name} (REST ${method} ${path}): ${res.status} ${await res.clone().text()}`);
    row = await lastAction();
    const restId = typeof viaRest.entity_id === 'string' ? viaRest.entity_id : viaRest.entity_id(await res.json());
    assert.deepEqual([row!.actor_id, row!.via, row!.action, row!.entity_id], [ADMIN, 'admin', name, restId], `${name} (REST)`);
  }

  // От имени пользователя через as_user_id — тоже строка журнала, без отмены.
  const w = await world();
  assert.equal((await mcpCall(admin, 'events_update', { as_user_id: w.hostId, event_id: w.eventId, name: 'Сам организатор' })).error, false);
  const row = await lastAction();
  assert.deepEqual([row!.action, row!.entity, row!.entity_id, row!.undoable, row!.via], ['events_update', 'user', String(w.hostId), false, 'mcp']);
  assert.equal((await mcpCall(admin, 'events_list', { as_user_id: w.hostId })).error, false);
  assert.equal((await lastAction())!.id, row!.id, 'чтение в журнал не пишется');

  // Страницы журнала: новые сверху, курсор ведёт дальше.
  const page = (await (await call(admin, 'GET', '/admin/actions?pagination_limit=2')).json()) as AdminActionList;
  assert.deepEqual([page.entries.length, page.has_more, page.entries[0]!.id], [2, true, row!.id]);
  assert.ok(!('before' in page.entries[0]!), 'снимки — только в admin_actions_get');
  const next = (await (await call(admin, 'GET', `/admin/actions?pagination_limit=2&pagination_cursor=${page.next_cursor}`)).json()) as AdminActionList;
  assert.ok(next.entries.every((e) => !page.entries.some((p) => p.id === e.id)) && next.entries.length === 2);
  const filtered = (await (await call(admin, 'GET', `/admin/actions?entity=user&entity_id=${w.hostId}`)).json()) as AdminActionList;
  assert.deepEqual(filtered.entries.map((e) => e.action), ['events_update']);
  assert.equal((await call(tma(w.guestId, 'Гость'), 'GET', '/admin/actions')).status, 403);

  await new Promise((r) => setTimeout(r, 20)); // заказы роликов уходят после фиксации
  illustrator.ask = draw;
  settings.illustratorUrl = '';
});

test('отмена: правка и удаление возвращаются целиком; после чужой правки, повторно и неотменяемое — отказ', async () => {
  settings.adminIds = [ADMIN];
  const admin = tma(ADMIN, 'Админ');
  const undo = (id: string) => call(admin, 'POST', `/admin/actions/${id}/undo`);
  const eventOf = async (id: string) => (await call(admin, 'GET', `/admin/events/${id}`)).json() as Promise<EventView>;

  // Правка события → отмена возвращает поля.
  const w = await world();
  const before = await eventOf(w.eventId);
  await call(admin, 'PATCH', `/admin/events/${w.eventId}`, { name: 'Переименовано', max_capacity: 10 });
  const edit = (await lastAction())!;
  assert.deepEqual([edit.undoable, edit.undone_by, (edit.input as { name: string }).name], [true, null, 'Переименовано']);
  const res = await undo(edit.id);
  assert.equal(res.status, 201);
  const undone = (await res.json()) as AdminAction;
  assert.deepEqual([undone.action, undone.undo_of, undone.entity_id], ['admin_actions_undo', edit.id, w.eventId]);
  assert.deepEqual((await eventOf(w.eventId)).event, before.event);
  assert.equal(((await (await call(admin, 'GET', `/admin/actions/${edit.id}`)).json()) as AdminAction).undone_by, undone.id);

  // Повторно — нельзя; отмена отмены возвращает правку.
  assert.deepEqual([(await undo(edit.id)).status, await (await undo(edit.id)).json()], [409, { error: 'already_undone' }]);
  assert.equal((await undo(undone.id)).status, 201);
  assert.equal((await eventOf(w.eventId)).event.name, 'Переименовано');

  // Правка после действия — отмена затёрла бы её: changed_since.
  await call(admin, 'PATCH', `/admin/events/${w.eventId}`, { name: 'Первая' });
  const first = (await lastAction())!;
  await call(admin, 'PATCH', `/admin/events/${w.eventId}`, { name: 'Вторая' });
  assert.deepEqual(await (await undo(first.id)).json(), { error: 'changed_since' });
  // Гость сам поменял ответ — это тоже изменение события.
  await call(admin, 'PATCH', `/admin/events/${w.eventId}`, { name: 'Третья' });
  const third = (await lastAction())!;
  assert.equal((await call(tma(w.guestId, 'Гость'), 'POST', `/events/${w.eventId}/rsvp`, { approval_status: 'maybe' })).status, 200);
  assert.deepEqual(await (await undo(third.id)).json(), { error: 'changed_since' });

  // Удаление события с гостями, типами билетов и отзывом → отмена возвращает всё.
  const v = await world();
  const guestsBefore = (await (await call(admin, 'GET', `/admin/events/${v.eventId}/guests`)).json()) as AdminGuest[];
  const full = await eventOf(v.eventId);
  assert.equal((await call(admin, 'DELETE', `/admin/events/${v.eventId}`)).status, 204);
  assert.equal((await call(admin, 'GET', `/admin/events/${v.eventId}`)).status, 404);
  assert.equal((await undo((await lastAction())!.id)).status, 201);
  const back = await eventOf(v.eventId);
  assert.deepEqual([back.event, back.ticket_types, back.guest_counts, back.feedback], [full.event, full.ticket_types, full.guest_counts, full.feedback]);
  assert.deepEqual(await (await call(admin, 'GET', `/admin/events/${v.eventId}/guests`)).json(), guestsBefore);

  // Удаление пользователя возвращается с его ответами; собранное событие — с обложкой.
  const u = await world();
  await db.insert(photos).values({ collected_external_id: `telegram:auditchan/${u.n}#0`, source: 'x', data: Buffer.from([0xff, 0xd8, 9]) });
  assert.deepEqual(await (await call(admin, 'DELETE', `/admin/users/${u.hostId}`)).json(), { error: 'user_has_events' });
  assert.equal((await call(admin, 'DELETE', `/admin/users/${u.guestId}`)).status, 204);
  assert.equal((await undo((await lastAction())!.id)).status, 201);
  assert.deepEqual(((await (await call(admin, 'GET', `/admin/events/${u.eventId}/guests`)).json()) as AdminGuest[]).map((g) => g.user_id), [u.guestId]);
  assert.equal((await call(admin, 'DELETE', `/admin/collected-events/${u.slug}`)).status, 204);
  assert.equal((await undo((await lastAction())!.id)).status, 201);
  const [cover] = await db.select().from(photos).where(eq(photos.collected_external_id, `telegram:auditchan/${u.n}#0`));
  assert.deepEqual(cover!.data, Buffer.from([0xff, 0xd8, 9]));

  // Неотменяемое: ушло в Telegram.
  await call(admin, 'POST', `/admin/conversations/${u.conversationId}/messages`, { text: 'Привет' });
  const sentAction = (await lastAction())!;
  assert.deepEqual([sentAction.action, sentAction.undoable], ['admin_messages_send', false]);
  assert.deepEqual([(await undo(sentAction.id)).status, await (await undo(sentAction.id)).json()], [409, { error: 'not_undoable' }]);
  assert.equal((await call(admin, 'POST', '/admin/actions/00000000-0000-0000-0000-000000000000/undo')).status, 404);
});

test('журнал: секреты входа в аккаунт не попадают в запись', async () => {
  settings.adminIds = [ADMIN];
  const w = await world();
  await db.update(tgAccounts).set({ status: 'login_code', session: 'secret-session' }).where(eq(tgAccounts.id, w.accountId));
  assert.equal((await call(tma(ADMIN, 'Админ'), 'POST', `/admin/accounts/${w.accountId}/login`, { secret: '73519' })).status, 204);
  const row = (await lastAction())!;
  assert.deepEqual([row.action, row.input, row.undoable], ['admin_accounts_login', {}, false]);
  const text = JSON.stringify(row);
  assert.ok(!text.includes('73519') && !text.includes('secret-session'), 'ни кода, ни сессии');
});

test('журнал: упавшее действие не оставляет ни изменения, ни записи, ни побочных действий', async () => {
  const w = await world();
  const [host] = await db.select().from(users).where(eq(users.id, w.hostId));
  const ctx = { actor: host!, via: 'admin' as const };
  let fired = false;
  await assert.rejects(audited(db, ctx, { action: 'test_fail', entity: 'event', id: w.eventId }, async (tx) => {
    await updateEvent(tx, host!, w.eventId, { name: 'Не сохранится' }); // своя транзакция сервиса — точка сохранения внутри
    afterCommit(tx, () => (fired = true));
    throw new AppError('boom', 409);
  }), { message: 'boom' });
  const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, w.eventId));
  assert.deepEqual([event!.name, event!.rev], ['Событие', 0]);
  assert.equal((await db.select().from(adminActions).where(eq(adminActions.action, 'test_fail'))).length, 0);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(fired, false, 'побочное действие не случилось');

  // Через вход: отказ правил — ни записи, ни изменения.
  settings.adminIds = [ADMIN];
  const count = (await db.select().from(adminActions)).length;
  const setGuest = (body: object) => call(tma(ADMIN, 'Админ'), 'PUT', `/admin/events/${w.eventId}/guests/${w.otherId}`, { approval_status: 'approved', event_ticket_type_id: w.t1, ...body });
  assert.equal((await setGuest({ plus_ones: 11 })).status, 400);
  await db.update(eventsTable).set({ allow_plus_one: false }).where(eq(eventsTable.id, w.eventId));
  assert.deepEqual(await (await setGuest({ plus_ones: 1 })).json(), { error: 'plus_one_off' });
  assert.equal((await db.select().from(adminActions)).length, count);
});

test('безопасность: чужой контакт не даёт права на событие, токен роли ограничен, сессия истекает, лимиты', async () => {
  // Опубликованное событие без личного контакта: посторонний подтвердить его не может.
  await db.delete(collectedEvents);
  const e = extracted({ title: 'Экстатик у моря' });
  await db.insert(collectedEvents).values({
    external_id: 'telegram:danangyoga/100#0', channel: 'danangyoga', announcement: { url: 'https://t.me/danangyoga/100' }, event: e,
    starts_at: new Date(e.starts_at), signup_url: '', status: 'published',
  });
  const bob = tma(7002, 'Боб');
  assert.equal((await call(bob, 'POST', '/collected-events/danangyoga-100-0/claim')).status, 403);
  // Контакт в анонсе, который команда ещё не проверила, права на событие не даёт.
  await db.update(collectedEvents).set({ status: 'pending', telegram_username: 'u7002' });
  assert.equal((await call(bob, 'POST', '/collected-events/danangyoga-100-0/claim')).status, 404);
  assert.deepEqual(((await (await call(bob, 'GET', '/me')).json()) as Me).claimable, []);

  // Токен роли: только MCP и только свои инструменты, даже если его владелец — админ.
  settings.adminIds = [70];
  await call(tma(70, 'Админ'), 'GET', '/events');
  const rpc = async (auth: string, method: string, params?: object) => (await (await call(auth, 'POST', '/mcp', { jsonrpc: '2.0', id: 1, method, params })).json()) as any;
  const names = async (auth: string) => ((await rpc(auth, 'tools/list')).result.tools as { name: string }[]).map((t) => t.name).sort();
  const role = `Bearer ${await issueToken(db, 70, { scope: 'support' })}`;
  assert.deepEqual(await names(role), ['collected_events_list', 'hosts_list', 'person_events_create', 'person_events_get', 'person_events_list', 'person_events_update']);
  assert.deepEqual(await names(`Bearer ${await issueToken(db, 70, { scope: 'catalog' })}`), ['collected_events_list', 'hosts_list']);
  const denied = await rpc(role, 'tools/call', { name: 'admin_users_search', arguments: {} });
  assert.ok(denied.error || denied.result.isError, 'инструмент команды токену роли не отвечает');
  for (const path of ['/me', '/events', '/admin/inbox']) assert.equal((await call(role, 'GET', path)).status, 403, `REST закрыт: ${path}`);

  // Сессия сайта живёт столько же, сколько cookie; бессрочным остаётся только токен без срока.
  assert.equal((await app.request('/me', { headers: { cookie: `ysw_session=${await issueToken(db, 7002, { ttlS: -1 })}` } })).status, 401);
  assert.equal((await app.request('/me', { headers: { cookie: `ysw_session=${await issueToken(db, 7002, { ttlS: 60 })}` } })).status, 200);

  // Ссылку на встречу видят организатор и те, кто идёт.
  const { event, ticket_types } = await newEvent(tma(7003, 'Хост'), { meeting_url: 'https://meet.example/x' });
  const guest = tma(7004, 'Гость');
  assert.equal(((await (await call(guest, 'GET', `/events/${event.id}`)).json()) as EventView).event.meeting_url, null);
  const going = await call(guest, 'POST', `/events/${event.id}/rsvp`, { approval_status: 'approved', event_ticket_type_id: ticket_types[0]!.id });
  assert.equal(((await going.json()) as EventView).event.meeting_url, 'https://meet.example/x');

  // Код входа в наш аккаунт Telegram лежит в базе зашифрованным, когда у API есть ключ сборщика.
  settings.accountsKey = 'ab'.repeat(32);
  const [account] = await db.insert(tgAccounts).values({ label: 'Шифр', phone: '+84900000077', status: 'login_code' }).returning();
  assert.equal((await call(tma(70, 'Админ'), 'POST', `/admin/accounts/${account!.id}/login`, { secret: '54321' })).status, 204);
  const [{ login }] = await db.select({ login: tgAccounts.login }).from(tgAccounts).where(eq(tgAccounts.id, account!.id)) as [{ login: { secret?: string; sealed?: string } }];
  const [iv, tag, body] = login.sealed!.split('.').map((part) => Buffer.from(part, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(settings.accountsKey, 'hex'), iv!).setAuthTag(tag!);
  assert.deepEqual([login.secret, Buffer.concat([decipher.update(body!), decipher.final()]).toString()], [undefined, '54321']);
  settings.accountsKey = '';

  // Лимит запросов в минуту на человека и размер тела запроса.
  settings.requestsPerMinute = 1;
  try {
    const limited = await call(guest, 'GET', '/events');
    assert.deepEqual([limited.status, limited.headers.get('retry-after')], [429, '60']);
  } finally {
    settings.requestsPerMinute = Infinity;
  }
  const huge = await app.request('/telegram/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(9 * 1024 * 1024) }, body: '{}' });
  assert.equal(huge.status, 413);
});
