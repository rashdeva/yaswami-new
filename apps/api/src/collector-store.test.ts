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
  await sql`truncate users, collected_events, hosts, tg_accounts, conversations, collector_cursors, tg_peers cascade`;
  await sql`delete from sources`;
  await sql`delete from cities where id <> 'danang'`; // города из прошлого запуска
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
  // Чаты города — тоже источники, но анонсы из них не берутся: они в chats(), со своим городом.
  await store.addSources(['big_chat'], 'leads');
  // Уже был с другим видом — не переделываем, но возвращаем расхождение: сборщик о нём предупредит.
  assert.deepEqual((await store.addSources(['Big_Chat'])).map((s: any) => [s.channel, s.kind]), [['big_chat', 'leads']]);
  assert.deepEqual(await store.addSources([]), []);
  assert.deepEqual((await store.sources()).map((s: any) => [s.channel, s.city_id, s.host_username]), [['danang', 'danang', null], ['yoga', 'danang', null]]);
  assert.deepEqual((await store.chats()).map((c: any) => [c.chat, c.city_id, c.city]), [['big_chat', 'danang', 'Дананг']]);
  assert.deepEqual((await store.cities()).map((c: any) => [c.id, c.name]), [['danang', 'Дананг']]);
  await sql`update sources set enabled = false where channel = 'yoga'`;
  assert.deepEqual([...(await store.knownChannels())].filter(([c]) => ['danang', 'yoga'].includes(c)), [['danang', 'есть'], ['yoga', 'выключен']]);
  await sql`update sources set enabled = true where channel = 'yoga'`;
  await sql`delete from sources where kind <> 'announcements'`;
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
  // Команда поправила событие посреди прохода: дополнение по снятой в начале версии её правку не затирает.
  assert.ok(await store.upsert({ ...row, event: { ...event, price: '100k', place: 'Пляж' }, loaded_at: known.loaded_at }), 'версия та же — пишем');
  const [fresh] = await store.upcoming();
  await sql`update collected_events set event = event || '{"title":"Йога (правка)"}', updated_at = now() where external_id = ${external_id}`;
  assert.equal(await store.upsert({ ...row, event: { ...event, price: '200k' }, loaded_at: fresh.loaded_at }), null, 'строку поменяли — пропуск');
  const [edited] = await store.upcoming();
  assert.deepEqual([edited.event.title, edited.event.price, edited.event.place], ['Йога (правка)', '100k', 'Пляж']);
  await store.upsert({ ...row, event: { ...event, price: '100k' }, loaded_at: edited.loaded_at }); // остальной тест — на прежнем событии

  await store.setStats('telegram:danang/42#', { views: 100, reactions: 5 });
  await store.saveCover(external_id, 'telegram:danang/42', { url: 'https://media.test/covers/collected/danang-42-0-ab.jpg' });
  await store.saveCover(external_id, 'telegram:danang/42', { data: Buffer.from([0xff, 0xd8, 2]) }); // обложка уже есть — не трогаем
  assert.deepEqual((await sql`select url, data from photos where collected_external_id = ${external_id}`).map((r) => [r.url, r.data]), [['https://media.test/covers/collected/danang-42-0-ab.jpg', null]], 'файл в бакете — в базе только адрес');
  assert.deepEqual((await store.upcoming()).map((e: any) => e.has_cover), [true]);
  assert.deepEqual((await store.withoutTopic()).map((e: any) => [e.external_id, e.city, e.timezone]), [[external_id, 'Дананг', 'Asia/Ho_Chi_Minh']], 'повторный разбор — в городе и поясе события');
  await store.setEvent(external_id, { ...event, topic: 'йога' });
  assert.equal((await store.withoutTopic()).length, 0);

  // Повторный разбор старых событий (refresh.mjs): публикация без media ждёт, после разбора — отмечена.
  assert.deepEqual((await store.withoutMedia()).map((e: any) => [e.external_id, e.city, e.timezone]), [[external_id, 'Дананг', 'Asia/Ho_Chi_Minh']]);
  await store.refreshed(external_id, { ...event, topic: 'йога', description: 'Полное описание' }, [{ type: 'photo', url: 'https://m/1.jpg' }]);
  assert.equal((await store.withoutMedia()).length, 0);
  const [again] = await sql`select event->>'description' as description, announcement->'media' as media, announcement->>'url' as url from collected_events`;
  assert.deepEqual([again!.description, again!.media, again!.url], ['Полное описание', [{ type: 'photo', url: 'https://m/1.jpg' }], 'https://t.me/danang/42']);

  // Профиль собираем только по одобренным событиям.
  assert.equal((await store.unprofiled()).length, 0);
  await sql`update collected_events set status = 'approved'`;
  assert.deepEqual((await store.unprofiled()).map((r: any) => [r.username, r.city_id]), [['anna_yoga', 'danang']]);

  // Доверенный источник: одобренных не меньше порога и ни одного отклонённого. Статус пишется только при вставке.
  assert.deepEqual(await store.trustedChannels(1), ['danang']);
  assert.deepEqual(await store.trustedChannels(2), []);
  const second = { ...row, external_id: 'telegram:danang/43#0', status: 'approved' };
  await store.upsert(second);
  await store.upsert({ ...second, status: 'pending' });
  assert.equal((await sql`select status from collected_events where external_id = ${second.external_id}`)[0]!.status, 'approved');
  assert.deepEqual(await store.trustedChannels(2), ['danang']);
  await sql`update collected_events set status = 'rejected' where external_id = ${second.external_id}`;
  assert.deepEqual(await store.trustedChannels(1), []);
});

test('сборщик: организаторы, их услуги и фото', async () => {
  // Пользователь 777 входил через Telegram 500: id пользователя и Telegram id разные (ADR-0008).
  await sql`insert into users (id, first_name, lang, timezone) values (777, 'Анна', 'ru', 'UTC')`;
  await sql`insert into user_identities (provider, subject, user_id) values ('telegram', '500', 777)`;
  // Заготовка команды заполняется на месте; вошедший в сервис сразу привязан.
  const [stub] = await sql`insert into hosts (username, name) values ('anna_yoga', '@anna_yoga') returning id`;
  await sql`insert into hosts (username, name) values ('nobody_here', '@nobody_here')`;
  assert.deepEqual([...await store.requestedHosts()], ['anna_yoga', 'nobody_here']);
  await store.rejectRequestedHost('nobody_here');
  await store.saveHost({ telegram_id: 500, username: 'anna_yoga', name: 'Анна', bio: 'йога', channel: 'anna_channel', summary: 'Ведёт йогу', city_id: 'danang' });
  const [host] = await sql`select id, name, user_id, status from hosts where telegram_id = 500`;
  assert.deepEqual([host!.id, host!.name, Number(host!.user_id)], [stub!.id, 'Анна', 777]);
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
  await sql`insert into cities (id, name, timezone) values ('hanoi', 'Ханой', 'Asia/Ho_Chi_Minh') on conflict do nothing`;
  await store.saveOffer({ telegram_id: 501, username: 'boris', name: 'Борис', summary: null, offer_url: 'https://t.me/chat/2', practices: [{ title: 'Бокс', topic: 'спорт', description: null, price: null }], city_id: 'hanoi' });
  assert.equal(await store.hasPractices('boris'), true);
  assert.equal((await sql`select city_id from hosts where telegram_id = 501`)[0]!.city_id, 'hanoi', 'мастер получает город чата');
  // Разбор услуги: из объявления — сразу; без него — classifyPractices (опубликованные первыми, отклонённые не трогаем).
  await store.saveOffer({ telegram_id: 502, username: 'vera', name: 'Вера', summary: null, offer_url: 'https://t.me/chat/3', city_id: 'hanoi',
    practices: [{ title: 'Скрипка', topic: 'обучение', description: null, price: '200k', category: 'lessons', formats: ['personal', 'online'], for_kids: true, price_amount: 200000, price_currency: 'VND' }] });
  assert.deepEqual({ ...(await sql`select category, formats, for_kids, price_amount, price_currency from practices where title = 'Скрипка'`)[0] }, { category: 'lessons', formats: ['personal', 'online'], for_kids: true, price_amount: '200000', price_currency: 'VND' });
  await sql`update practices set status = 'rejected' where title = 'Массаж'`;
  const unclassified = await store.practicesToClassify(10);
  assert.deepEqual(unclassified.map((p: any) => [p.title, p.city]), [['Йога', 'Дананг'], ['Бокс', 'Ханой']]);
  await store.setPracticeDetails(unclassified[0].id, { category: 'sport', formats: [], for_kids: false, price_amount: 300000, price_currency: 'VND' });
  assert.deepEqual((await store.practicesToClassify(10)).map((p: any) => p.title), ['Бокс']);
  assert.deepEqual({ ...(await sql`select category, formats, price_amount from practices where title = 'Йога'`)[0] }, { category: 'sport', formats: [], price_amount: '300000' });
  // Разобрана до категорий (ADR-0012) — снова в очереди, чтобы получить категорию.
  await sql`update practices set category = null where title = 'Скрипка'`;
  assert.deepEqual((await store.practicesToClassify(10)).map((p: any) => [p.title, p.topic]), [['Бокс', 'спорт'], ['Скрипка', 'обучение']]);
  await sql`update practices set category = 'lessons' where title = 'Скрипка'`;
  await sql`update hosts set profiled_at = now() where telegram_id = 502`; // Вера нужна только здесь: профили ниже проверяются на Анне и Борисе

  assert.deepEqual((await store.stalePhotos(7, 5)).map((h: any) => h.channel), ['anna_channel']);
  await store.savePhotos(host!.id, ['telegram:anna_channel/1', 'telegram:anna_channel/2'], [{ source: 'telegram:anna_channel/1', data: Buffer.from([1]) }, { source: 'telegram:anna_channel/2', data: Buffer.from([2]) }]);
  await store.savePhotos(host!.id, ['telegram:anna_channel/2'], []);
  assert.deepEqual([...await store.photoSources(host!.id)], ['telegram:anna_channel/2']);
  await store.photosChecked(host!.id);
  assert.equal((await store.stalePhotos(7, 5)).length, 0);

  // Пересмотр профилей: только что собранный не трогаем; мастер из чата (offers) ни разу не смотрен — первый в очереди.
  assert.deepEqual((await store.staleProfiles(7, 5)).map((h: any) => [h.username, Number(h.telegram_id), h.has_summary]), [['boris', 501, false]]);
  await sql`update hosts set profiled_at = now() - interval '8 days', name = 'Анна (правка команды)' where telegram_id = 500`;
  assert.deepEqual((await store.staleProfiles(7, 1)).map((h: any) => h.username), ['boris'], 'сначала несмотренные');
  await store.refreshHost({ telegram_id: 500, bio: 'йога и пилатес', channel: null, summary: 'новая' });
  const [anna] = await sql`select name, bio, channel, summary from hosts where telegram_id = 500`;
  assert.deepEqual([anna!.name, anna!.bio, anna!.channel, anna!.summary], ['Анна (правка команды)', 'йога и пилатес', 'anna_channel', 'Ведёт йогу'], 'имя и сводку команды не трогаем, канал не стираем');
  await store.profileChecked(501);
  assert.equal((await store.staleProfiles(7, 5)).length, 0);
  // Отклонённых не пересматриваем и фото им не качаем.
  await sql`update hosts set status = 'rejected', profiled_at = null, photos_checked_at = null where telegram_id = 500`;
  assert.deepEqual([(await store.staleProfiles(7, 5)).length, (await store.stalePhotos(7, 5)).length], [0, 0]);
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

test('сборщик: Запросы организаторов и Находки', async () => {
  await sql`insert into users (id, first_name, lang, timezone) values (601, 'Маша', 'ru', 'Asia/Ho_Chi_Minh')`;
  const [host] = await sql`insert into hosts (telegram_id, username, name, user_id) values (601, 'masha', 'Маша', 601) returning id`;
  const [stranger] = await sql`insert into hosts (telegram_id, username, name) values (602, 'nobody', 'Никто') returning id`;
  const [search] = await sql`insert into host_searches (host_id, query) values (${host!.id}, 'ищут массаж') returning id`;
  await sql`insert into host_searches (host_id, query, status) values (${host!.id}, 'выключен', 'paused')`;
  await sql`insert into host_searches (host_id, query) values (${stranger!.id}, 'не подтверждён')`; // организатор не входил — не ищем

  assert.deepEqual((await store.activeSearches()).map((s: any) => [s.id, s.query, s.keywords, s.host_telegram_id]), [[search!.id, 'ищут массаж', null, 601]]);
  // Текст сменился, пока ИИ думал, — старые слова не пишем.
  await store.saveSearchKeywords(search!.id, 'другой текст', ['йог']);
  await store.saveSearchKeywords(search!.id, 'ищут массаж', ['массаж', 'спин']);
  assert.deepEqual((await store.activeSearches())[0].keywords, ['массаж', 'спин']);

  const match = { search_id: search!.id, chat: 'danang_chat', message_id: 1, url: 'https://t.me/danang_chat/1', author: { id: 42, name: 'Лена', username: null }, text: 'Нужен массаж', sent_at: new Date().toISOString() };
  await store.saveSearchMatch(match);
  await store.saveSearchMatch(match);
  assert.deepEqual((await sql`select author_id::int, author_name, author_username, text from host_search_matches`).map((r) => ({ ...r })), [{ author_id: 42, author_name: 'Лена', author_username: null, text: 'Нужен массаж' }]);
});

test('сборщик: темы из базы, кандидаты из меток, новая тема переводит события без темы', async () => {
  await sql`delete from collected_events`;
  await sql`delete from topics where origin <> 'built_in'`;
  assert.deepEqual([(await store.topics()).length, (await store.topics())[0].name], [12, 'баня']);

  const add = (n: number, tag: string, host: string, topic = 'другое') => sql`
    insert into collected_events (external_id, channel, announcement, event, starts_at, signup_url, telegram_username)
    values (${`telegram:t/${n}#0`}, 't', ${sql.json({ url: 'https://t.me/t/1' })}, ${sql.json({ ...event, title: `Событие ${n}`, tags: [tag], topic })}, ${starts}, '', ${host})`;
  await add(1, 'Падел', 'a');
  await add(2, 'падел', 'b');
  await add(3, 'падел', 'b');
  await add(4, 'свечи', 'a');
  await add(5, 'падел', 'c', 'спорт'); // с темой — не в счёт
  const limits = (minEvents: number, minHosts: number) => ({ minEvents, minHosts, splitEvents: 2, splitHosts: 2 });
  assert.deepEqual((await store.topicCandidates(limits(1, 1))).map((c: any) => [c.tag, c.inside, c.events_count, c.hosts_count]), [['падел', null, 3, 2], ['свечи', null, 1, 1]]);
  assert.deepEqual((await store.topicCandidates(limits(3, 3))).length, 0, 'три события у двух организаторов — ещё не тема');

  const topic = { name: 'ракеточный спорт', slug: 'racket', emoji: '🏓', color: '#0EA5E9', what: 'w', why: 'y', first: 'f', not_for: 'n', tags: ['падел', 'пиклбол'] };
  assert.equal(await store.addTopic(topic), true);
  assert.equal(await store.addTopic({ ...topic, slug: 'racket2' }), false, 'имя занято');
  assert.deepEqual((await sql`select origin, color, position from topics where name = ${topic.name}`).map((r) => ({ ...r })), [{ origin: 'collector', color: '#0ea5e9', position: 13 }]);
  assert.deepEqual((await sql`select event->>'topic' as topic from collected_events order by external_id`).map((r) => r.topic), ['ракеточный спорт', 'ракеточный спорт', 'ракеточный спорт', 'другое', 'спорт']);
  assert.deepEqual((await store.topicCandidates(limits(1, 1))).map((c: any) => c.tag), ['свечи']);

  // Метка внутри широкой темы: кандидат со своим порогом; выделенная тема забирает события только с этой меткой
  // (метки от ИИ могут быть шире темы) и достаётся подписанным на широкую.
  await add(6, 'мафия', 'a', 'игры');
  await add(7, 'мафия', 'b', 'игры');
  await add(8, 'игра', 'c', 'игры');
  await sql`insert into users (id, first_name, lang, timezone) values (901, 'Зоя', 'ru', 'UTC'), (902, 'Лев', 'ru', 'UTC')`;
  await sql`insert into subscriptions (user_id, topics) values (901, ${sql.json(['игры'])}), (902, ${sql.json(['йога'])})`;
  assert.deepEqual((await store.topicCandidates(limits(5, 5))).map((c: any) => [c.tag, c.inside, c.events_count, c.inside_events_count]), [['мафия', 'игры', 2, 3]]);
  assert.equal(await store.addTopic({ ...topic, name: 'мафия', slug: 'mafia', tags: ['мафия', 'игра'] }, { from: 'игры', tag: 'мафия' }), true);
  assert.deepEqual((await sql`select event->>'topic' as topic from collected_events where external_id in ('telegram:t/6#0', 'telegram:t/7#0', 'telegram:t/8#0') order by external_id`).map((r) => r.topic), ['мафия', 'мафия', 'игры']);
  assert.deepEqual((await sql`select topics from subscriptions order by user_id`).map((r) => r.topics), [['игры', 'мафия'], ['йога']]);
  assert.deepEqual((await store.topics()).slice(-2).map((t: any) => t.name), ['ракеточный спорт', 'мафия']);
  await sql`delete from topics where origin <> 'built_in'`;
});

test('сборщик: поиск источников — очередь городов, итог, найденные каналы в источниках', async () => {
  await sql`delete from source_searches`;
  await sql`delete from sources`;
  assert.ok((await store.cities()).find((c: any) => c.id === 'danang').aliases.includes('Danang'), 'у Дананга другие написания — из миграции');
  await store.queueSourceSearches(30);
  await store.queueSourceSearches(30); // свежий поиск уже есть — второй не ставим
  const cities = (await store.cities()).length; // другие тесты заводят свои города: по поиску на каждый
  assert.equal((await sql`select count(*)::int n from source_searches`)[0]!.n, cities);
  await sql`delete from source_searches where city_id <> 'danang'`;

  const search = await store.takeSourceSearch();
  assert.equal(search.city_id, 'danang');
  assert.equal(search.names[0], 'Дананг');
  assert.equal(await store.takeSourceSearch(), null, 'идущий второй раз не берётся');
  await store.requeueSourceSearches(); // перезапуск сборщика посреди поиска
  assert.equal((await store.takeSourceSearch()).id, search.id);

  await store.addSources(['Danang_Yoga']);
  await sql`update sources set enabled = false`;
  assert.deepEqual(await store.addFoundSources('danang', ['danang_yoga', 'danang_tennis']), ['danang_tennis'], 'выключенный командой не возвращается');
  assert.deepEqual(await store.addFoundSources('danang', []), []);
  const results = [{ channel: 'danang_tennis', title: 'Теннис', group: false, members: 10, posts_30d: 8, event_like: 4, kind: 'announcements' }];
  await store.finishSourceSearch(search.id, { results });
  const [done] = await sql`select status, results, finished_at from source_searches`;
  assert.deepEqual([done!.status, done!.results, Boolean(done!.finished_at)], ['done', results, true]);

  await sql`update source_searches set created_at = now() - interval '31 days'`;
  await store.queueSourceSearches(30); // месяц прошёл — ищем снова
  await sql`delete from source_searches where city_id <> 'danang'`;
  const again = await store.takeSourceSearch();
  await store.finishSourceSearch(again.id, { error: 'FLOOD_WAIT' });
  assert.deepEqual((await sql`select status, error from source_searches where id = ${again.id}`).map((r) => [r.status, r.error]), [['failed', 'FLOOD_WAIT']]);
});

test('сборщик: найденные каналы аккаунта и выключение пропавшего источника', async () => {
  await store.savePeers('100', [{ username: 'danang_yoga', peer_id: '-1001', access_hash: '11' }, { username: 'tea', peer_id: '-1002', access_hash: '22' }]);
  await store.savePeers('100', [{ username: 'tea', peer_id: '-1003', access_hash: '33' }]); // канал сменил владельца username
  await store.savePeers('100', []);
  await store.savePeers('200', [{ username: 'tea', peer_id: '-1002', access_hash: '99' }]); // у другого аккаунта свой access_hash
  assert.deepEqual((await store.peers('100')).map((p: any) => [p.username, p.peer_id, p.access_hash]).sort(), [['danang_yoga', '-1001', '11'], ['tea', '-1003', '33']]);
  assert.equal((await store.peers('300')).length, 0);
  // Повтор username и тысячи каналов за раз: раньше вставка падала целиком и не сохранялось ничего.
  const many = Array.from({ length: 2500 }, (_, i) => ({ username: `chat_${i}`, peer_id: `-100${i}`, access_hash: String(i) }));
  await store.savePeers('300', [...many, { username: 'Chat_7', peer_id: '-1009', access_hash: '9' }]);
  const saved = await store.peers('300');
  assert.equal(saved.length, 2500);
  assert.deepEqual(saved.filter((p: any) => p.username === 'chat_7').map((p: any) => p.peer_id), ['-1009']);

  await sql`delete from sources`;
  await store.addSources(['DanceHall']);
  await store.disableSource('dancehall', 'В Telegram нет канала с таким username');
  assert.deepEqual((await sql`select enabled, disabled_reason from sources`).map((r) => [r.enabled, r.disabled_reason]), [[false, 'В Telegram нет канала с таким username']]);
  assert.equal((await store.sources()).length, 0, 'выключенный не читается');
  await store.disableSource('dancehall', 'другая причина'); // уже выключен — причину не переписываем
  assert.equal((await sql`select disabled_reason from sources`)[0]!.disabled_reason, 'В Telegram нет канала с таким username');
});

test('сборщик: профили Instagram — свой список, Instagram организаторов, медиа не перечитываются юзерботом', async () => {
  await sql`delete from sources`;
  await sql`insert into hosts (username, name, instagram_handle, city_id) values ('ig_anna', 'Анна', 'anna.yoga', 'danang')`;
  await sql`insert into hosts (username, name, instagram_handle, status) values ('ig_spam', 'Спам', 'spam', 'rejected')`;
  assert.deepEqual([...await store.adoptHostInstagram(5)], ['instagram:anna.yoga'], 'отклонённый организатор — не источник');
  assert.deepEqual([...await store.adoptHostInstagram(5)], [], 'уже в источниках');
  await store.addSources(['danang']);
  await sql`insert into sources (channel, kind) values ('instagram:leads_by_mistake', 'leads')`;
  assert.deepEqual((await store.sources()).map((s: any) => s.channel), ['danang'], 'юзербот Instagram не читает');
  assert.deepEqual((await store.chats()).map((c: any) => c.chat), []);
  assert.deepEqual((await store.instagramSources()).map((s: any) => [s.channel, s.host_username, s.city]), [['instagram:anna.yoga', 'ig_anna', 'Дананг'], ['instagram:leads_by_mistake', null, 'Дананг']]);
  // Профиль нашёл поиск, организатор у источника не указан, но этот Instagram записан у организатора — контакт его.
  await sql`insert into sources (channel) values ('instagram:Found.By.Tag')`;
  await sql`insert into hosts (username, name, instagram_handle) values ('ig_found', 'Найденный', 'found.by.tag')`;
  assert.equal((await store.instagramSources()).find((s: any) => s.channel === 'instagram:Found.By.Tag').host_username, 'ig_found');

  const event = { title: 'Йога', description: '', starts_at: new Date(Date.now() + 86_400_000).toISOString(), ends_at: null, place: null, address: null, price: null, tags: [], telegram_username: null, whatsapp_phone: null, instagram_username: 'anna.yoga', url: null };
  await store.upsert({ external_id: 'instagram:C1#0', channel: 'instagram:anna.yoga', city_id: 'danang', announcement: { id: 'C1', url: 'https://www.instagram.com/p/C1/', text: '' }, event, signup_url: 'https://ig.me/m/anna.yoga' });
  await store.setStats('instagram:C1#', { views: 5, reactions: 7 });
  assert.deepEqual([...await store.instagramWithoutCover()], [], 'без фото в бакете — нечем');
  await sql`update collected_events set announcement = announcement || ${sql.json({ media: [{ type: 'video', url: 'https://m/v.mp4' }, { type: 'photo', url: 'https://m/1.jpg' }, { type: 'photo', url: 'https://m/2.jpg' }] })} where external_id = 'instagram:C1#0'`;
  assert.deepEqual((await store.instagramWithoutCover()).map((r: any) => [r.external_id, r.url]), [['instagram:C1#0', 'https://m/1.jpg']], 'первое фото, а не ролик');
  await store.saveCover('instagram:C1#0', 'instagram:C1', { data: Buffer.from([0xff, 0xd8]) });
  assert.deepEqual([...await store.instagramWithoutCover()], [], 'обложка уже есть');
  assert.deepEqual((await sql`select views, reactions from collected_events where external_id = 'instagram:C1#0'`).map((r) => [r.views, r.reactions]), [[5, 7]]);
  assert.ok(!(await store.withoutMedia()).some((e: any) => e.external_id === 'instagram:C1#0'));
  await sql`delete from photos where collected_external_id = 'instagram:C1#0'`;
  await sql`delete from collected_events where external_id = 'instagram:C1#0'`;
  await sql`delete from sources`;
  await sql`delete from hosts where username in ('ig_anna', 'ig_spam', 'ig_found')`;
});

test('сборщик: товары мастеров — источники, мастер из товаров, повтор не меняет решение команды', async () => {
  await sql`delete from sources`;
  // Канал мастера (у источника Host) и группа объявлений; анонсы и вопросы из них не берутся.
  const [melody] = await sql`insert into hosts (telegram_id, username, name) values (-100900, 'melody_cafe', 'Melody') returning id`;
  await sql`insert into sources (channel, kind, host_id) values ('danangmelody', 'products', ${melody!.id})`;
  await sql`insert into sources (channel, kind) values ('ads_danang', 'products')`;
  await sql`insert into sources (channel, kind, enabled) values ('off_products', 'products', false)`;
  assert.deepEqual((await store.productSources()).map((s: any) => [s.channel, s.host_id, s.host_username, s.host_status, s.city_id, s.city]), [
    ['danangmelody', melody!.id, 'melody_cafe', 'pending', 'danang', 'Дананг'],
    ['ads_danang', null, null, null, 'danang', 'Дананг'],
  ]);
  assert.deepEqual([(await store.sources()).length, (await store.chats()).length], [0, 0], 'товары — не анонсы и не вопросы');

  // Мастер из группы: ещё нет — новый Host с городом источника; входил в Ясвами — сразу привязан (users.id — не Telegram id, ADR-0008).
  assert.equal(await store.hostByUsername('olga_cook'), undefined);
  await sql`insert into users (id, first_name, lang, timezone) values (951, 'Ольга', 'ru', 'UTC')`;
  await sql`insert into user_identities (provider, subject, user_id) values ('telegram', '910', 951)`;
  const olga = await store.saveMaker({ telegram_id: 910, username: 'olga_cook', name: 'Ольга', city_id: 'danang', offer_url: 'https://t.me/ads_danang/5' });
  assert.equal(olga.status, 'pending');
  assert.deepEqual({ ...await store.hostByUsername('olga_cook') }, { id: olga.id, status: 'pending' });
  const [row] = await sql`select user_id, city_id, offer_url from hosts where id = ${olga.id}`;
  assert.deepEqual([Number(row!.user_id), row!.city_id, row!.offer_url], [951, 'danang', 'https://t.me/ads_danang/5']);
  assert.equal((await store.saveMaker({ telegram_id: 910, username: 'olga_bakes', name: 'Ольга', city_id: 'danang', offer_url: 'x' })).id, olga.id, 'тот же человек под новым username');

  // Один пост «наличие» — несколько товаров, новые ждут решения команды.
  const day = (d: number) => new Date(Date.UTC(2026, 10, d, 9)).toISOString();
  const post1 = { announcement: { url: 'https://t.me/danangmelody/1', text: 'Наличие 20 ноября' }, posted_at: day(20), photo_url: 'https://m/1.jpg' };
  const saved = await store.saveProducts(melody!.id, [
    { title: 'Медовик порционно', description: null, price: '55k', unit: '100 г', category: 'bakery' },
    { title: 'Творог', description: 'домашний', price: '120k', unit: '0,5 кг', category: 'dairy' },
  ], post1);
  assert.deepEqual(saved.map((r: any) => r.created), [true, true]);
  assert.deepEqual((await sql`select title, title_key, status, price, unit, photo_url from products order by title`).map((p) => [p.title, p.title_key, p.status, p.price, p.unit, p.photo_url]), [
    ['Медовик порционно', 'медовик порционно', 'pending', '55k', '100 г', 'https://m/1.jpg'],
    ['Творог', 'творог', 'pending', '120k', '0,5 кг', 'https://m/1.jpg'],
  ]);

  // Повтор в следующем посте: строку не добавляет, цену и posted_at обновляет, решение команды и название не трогает;
  // чего в посте нет (фото, вес), остаётся прежним.
  await sql`update products set status = 'published' where title = 'Медовик порционно'`;
  const post2 = { announcement: { url: 'https://t.me/danangmelody/2', text: 'Наличие 21 ноября' }, posted_at: day(21), photo_url: null };
  const again = await store.saveProducts(melody!.id, [{ title: '  МЕДОВИК   порционно', description: null, price: '60k', unit: null, category: 'bakery' }], post2);
  assert.deepEqual(again.map((r: any) => r.created), [false]);
  const medovik = await sql`select title, status, price, unit, photo_url, posted_at, announcement from products where title_key = 'медовик порционно'`;
  assert.equal(medovik.length, 1);
  assert.deepEqual([medovik[0]!.title, medovik[0]!.status, medovik[0]!.price, medovik[0]!.unit, medovik[0]!.photo_url, medovik[0]!.posted_at.toISOString(), medovik[0]!.announcement.url],
    ['Медовик порционно', 'published', '60k', '100 г', 'https://m/1.jpg', day(21), 'https://t.me/danangmelody/2']);
  // Пост старше уже записанного (повторный backfill) ничего не меняет.
  assert.deepEqual(await store.saveProducts(melody!.id, [{ title: 'Медовик порционно', description: null, price: '50k', unit: null, category: 'bakery' }], { ...post1, posted_at: day(19) }), []);
  assert.equal((await sql`select price from products where title_key = 'медовик порционно'`)[0]!.price, '60k');
  // Тот же товар у другого мастера — своя строка.
  await store.saveProducts(olga.id, [{ title: 'Творог', description: null, price: null, unit: null, category: 'dairy' }], post2);
  assert.equal((await sql`select count(*)::int as n from products where title_key = 'творог'`)[0]!.n, 2);

  // Тот же текст поста снова (объявление повторили): в ИИ не идёт, товарам поста — новая дата и ссылка.
  assert.equal(await store.touchProducts({ text: 'Новый пост', url: 'https://t.me/x/1', posted_at: day(22) }), 0);
  assert.equal(await store.touchProducts({ text: 'Наличие 20 ноября', url: 'https://t.me/ads_danang/9', posted_at: day(23) }), 1);
  const [tvorog] = await sql`select posted_at, announcement from products where host_id = ${melody!.id} and title_key = 'творог'`;
  assert.deepEqual([tvorog!.posted_at.toISOString(), tvorog!.announcement], [day(23), { url: 'https://t.me/ads_danang/9', text: 'Наличие 20 ноября' }]);
  assert.equal(await store.touchProducts({ text: 'Наличие 20 ноября', url: 'https://t.me/old/1', posted_at: day(1) }), 1, 'старый повтор — известен, но дату не двигает');
  assert.equal((await sql`select announcement->>'url' as url from products where host_id = ${melody!.id} and title_key = 'творог'`)[0]!.url, 'https://t.me/ads_danang/9');

  await sql`delete from sources`;
  await sql`delete from hosts where id in (${melody!.id}, ${olga.id})`;
});
