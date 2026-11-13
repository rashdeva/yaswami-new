// Запросы сборщика (apps/collector/src/store.mjs) на настоящей базе. Сборщик пишет в таблицы API сырым SQL, и типы
// его не проверяют: этот тест — единственное, что ловит переименованную колонку до выкладки. Каждый запрос хранилища
// здесь вызван хотя бы раз, с аргументами той же формы, что в сборщике. Тест лежит в API: схема и миграции — его.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, test } from 'node:test';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
// @ts-expect-error сборщик написан на .mjs без типов
import { createStore } from '../../collector/src/store.mjs';
import { createDb } from './db/client.ts';

const url = new URL(process.env.DATABASE_URL ?? 'postgres://yaswami:yaswami@localhost:5432/yaswami');
// Своя база, рядом с базой api.test.ts: тесты идут параллельно и чистят таблицы.
const TEST_DB = `yaswami_test_${createHash('sha256').update(new URL('../../..', import.meta.url).pathname).digest('hex').slice(0, 8)}_store`;
let sql: postgres.Sql;
let store: any;

before(async () => {
  const admin = postgres(url.href, { max: 1 });
  const [found] = await admin`select 1 from pg_database where datname = ${TEST_DB}`;
  if (!found) await admin`create database ${admin(TEST_DB)}`;
  await admin.end();
  url.pathname = `/${TEST_DB}`;
  const db = createDb(url.href);
  await migrate(db, { migrationsFolder: new URL('../drizzle', import.meta.url).pathname });
  await db.$client.end();
  sql = postgres(url.href, { max: 1, onnotice: () => {} });
  await sql`truncate users, collected_events, hosts, tg_accounts, conversations, collector_cursors cascade`;
  await sql`delete from sources`;
  store = createStore(url.href);
});
after(async () => {
  await store.end();
  await sql.end();
});

const starts = new Date(Date.now() + 86_400_000).toISOString();
const event = { title: 'Йога на пляже', description: 'd', starts_at: starts, ends_at: null, place: null, address: null, price: null, tags: [], telegram_username: '@Anna_Yoga', whatsapp_phone: null, url: null };

test('сборщик: события, источники и отметки', async () => {
  await store.addSources(['danang', 'yoga']);
  await store.addSources([]);
  assert.deepEqual((await store.sources()).map((s: any) => [s.channel, s.city_id, s.host_username]), [['danang', 'danang', null], ['yoga', 'danang', null]]);
  await store.saveCursor('danang', 41);
  await store.saveCursor('danang', 42);
  assert.deepEqual(await store.cursors(), { danang: 42 });

  const external_id = 'telegram:danang/42#0';
  const row = { external_id, channel: 'danang', city_id: 'danang', announcement: { id: 'danang/42', url: 'https://t.me/danang/42', text: 'Йога' }, event, signup_url: 'https://t.me/anna_yoga' };
  await store.upsert(row);
  await store.upsert({ ...row, event: { ...event, price: '100k' } });
  const [known] = await store.upcoming();
  assert.deepEqual([known.external_id, known.event.price, known.status, known.has_cover], [external_id, '100k', 'pending', false]);
  assert.equal((await sql`select telegram_username from collected_events`)[0]!.telegram_username, 'anna_yoga', 'контакт — без @ и в нижнем регистре');

  await store.setStats('telegram:danang/42#', { views: 100, reactions: 5 });
  await store.saveCover(external_id, 'telegram:danang/42', Buffer.from([0xff, 0xd8, 1]));
  await store.saveCover(external_id, 'telegram:danang/42', Buffer.from([0xff, 0xd8, 2])); // обложка уже есть — не трогаем
  assert.deepEqual((await store.upcoming()).map((e: any) => e.has_cover), [true]);
  assert.deepEqual((await store.withoutTopic()).map((e: any) => e.external_id), [external_id]);
  await store.setEvent(external_id, { ...event, topic: 'йога' });
  assert.equal((await store.withoutTopic()).length, 0);

  // Повторный разбор старых событий (refresh.mjs): публикация без media ждёт, после разбора — отмечена.
  assert.deepEqual((await store.withoutMedia()).map((e: any) => e.external_id), [external_id]);
  await store.refreshed(external_id, { ...event, topic: 'йога', description: 'Полное описание' }, [{ type: 'photo', url: 'https://m/1.jpg' }]);
  assert.equal((await store.withoutMedia()).length, 0);
  const [again] = await sql`select event->>'description' as description, announcement->'media' as media, announcement->>'url' as url from collected_events`;
  assert.deepEqual([again!.description, again!.media, again!.url], ['Полное описание', [{ type: 'photo', url: 'https://m/1.jpg' }], 'https://t.me/danang/42']);

  // Профиль собираем только по одобренным событиям.
  assert.equal((await store.unprofiled()).length, 0);
  await sql`update collected_events set status = 'approved'`;
  assert.deepEqual((await store.unprofiled()).map((r: any) => [r.username, r.city_id]), [['anna_yoga', 'danang']]);
});

test('сборщик: организаторы, их услуги и фото', async () => {
  await sql`insert into users (id, first_name, lang, timezone) values (500, 'Анна', 'ru', 'UTC')`;
  // Заготовка команды заполняется на месте; вошедший в сервис сразу привязан.
  const [stub] = await sql`insert into hosts (username, name) values ('anna_yoga', '@anna_yoga') returning id`;
  await sql`insert into hosts (username, name) values ('nobody_here', '@nobody_here')`;
  assert.deepEqual([...await store.requestedHosts()], ['anna_yoga', 'nobody_here']);
  await store.rejectRequestedHost('nobody_here');
  await store.saveHost({ telegram_id: 500, username: 'anna_yoga', name: 'Анна', bio: 'йога', channel: 'anna_channel', summary: 'Ведёт йогу', city_id: 'danang' });
  const [host] = await sql`select id, name, user_id, status from hosts where telegram_id = 500`;
  assert.deepEqual([host!.id, host!.name, Number(host!.user_id)], [stub!.id, 'Анна', 500]);
  assert.equal((await store.requestedHosts()).length, 0);
  assert.equal((await store.unprofiled()).length, 0);
  assert.deepEqual([...await store.adoptHostChannels(5)], ['anna_channel']);
  assert.deepEqual((await store.sources()).find((s: any) => s.channel === 'anna_channel').host_username, 'anna_yoga');

  // Услуги из самопредставления: добавляются один раз и ждут решения; повтор не затирает то, что решила команда.
  assert.equal(await store.hasPractices(500), false);
  const offer = { telegram_id: 500, username: 'anna_yoga', name: 'Анна', summary: 'другая сводка', offer_url: 'https://t.me/chat/1' };
  await store.saveOffer({ ...offer, practices: [{ title: 'Йога', topic: 'йога', description: null, price: '300k' }, { title: 'Массаж', topic: 'телесные практики', description: 'час', price: null }] });
  assert.deepEqual([await store.hasPractices(500), await store.hasPractices('anna_yoga'), await store.hasPractices('nobody_here')], [true, true, false]);
  await sql`update practices set status = 'published' where title = 'Йога'`;
  await store.saveOffer({ ...offer, practices: [{ title: 'Новая', topic: 'йога', description: null, price: null }] });
  assert.deepEqual((await sql`select title, status, position from practices order by position`).map((p) => [p.title, p.status, p.position]), [['Йога', 'published', 0], ['Массаж', 'pending', 1]]);
  assert.equal((await sql`select summary from hosts where telegram_id = 500`)[0]!.summary, 'Ведёт йогу', 'сводку из профиля объявление не меняет');
  // Новый мастер — сразу с услугами.
  await store.saveOffer({ telegram_id: 501, username: 'boris', name: 'Борис', summary: null, offer_url: 'https://t.me/chat/2', practices: [{ title: 'Бокс', topic: 'спорт', description: null, price: null }] });
  assert.equal(await store.hasPractices('boris'), true);

  assert.deepEqual((await store.stalePhotos(7, 5)).map((h: any) => h.channel), ['anna_channel']);
  await store.savePhotos(host!.id, ['telegram:anna_channel/1', 'telegram:anna_channel/2'], [{ source: 'telegram:anna_channel/1', data: Buffer.from([1]) }, { source: 'telegram:anna_channel/2', data: Buffer.from([2]) }]);
  await store.savePhotos(host!.id, ['telegram:anna_channel/2'], []);
  assert.deepEqual([...await store.photoSources(host!.id)], ['telegram:anna_channel/2']);
  await store.photosChecked(host!.id);
  assert.equal((await store.stalePhotos(7, 5)).length, 0);
});

test('сборщик: аккаунты и очередь отправки', async () => {
  const [account] = await sql`insert into tg_accounts (label, phone, status) values ('Аня', '+84900000009', 'login_code') returning id`;
  await store.accountUpdate(account!.id, { status: 'active', session: 'sealed', login: null, last_error: null, cold_paused_until: new Date() });
  await store.accountUpdate(account!.id, { login: { sealed: 'x' } });
  assert.deepEqual((await store.accounts()).map((a: any) => [a.label, a.status, a.session, a.login]), [['Аня', 'active', 'sealed', { sealed: 'x' }]]);

  const [conversation] = await sql`insert into conversations (channel, account_id, peer_id, peer_name, peer_username) values ('account', ${account!.id}, 42, 'Тим', 'tim') returning id`;
  const [message] = await sql`insert into messages (conversation_id, direction, author, text, status, meta) values (${conversation!.id}, 'out', 'admin:1', 'Привет', 'queued', ${sql.json({ account_id: account!.id })}) returning id`;
  const [queued] = await store.queued();
  assert.deepEqual([queued.id, queued.text, queued.account_id, Number(queued.peer_id), queued.peer_username], [message!.id, 'Привет', account!.id, 42, 'tim']);
  // Забрать сообщение можно один раз; оборванная отправка после перезапуска — «не доставлено», а не вторая попытка.
  assert.deepEqual([await store.claim(message!.id), await store.claim(message!.id)], [true, false]);
  assert.equal((await store.queued()).length, 0);
  await store.failStuck();
  assert.equal((await sql`select status from messages`)[0]!.status, 'failed');
  await store.messageStatus(message!.id, 'sent');
  assert.equal((await sql`select status from messages`)[0]!.status, 'sent');
});
