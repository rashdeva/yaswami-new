// Таблицы Postgres. Источник правды — схемы в @yaswami/core; блок в конце файла роняет typecheck,
// если строка таблицы разошлась с типом из ядра.
import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { bigint, boolean, check, customType, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { Address, AdminAction, AdminEntity, City, Notification, CollectedEvent, CollectedMedia, Conversation, Event, Feature, FeedbackVia, Guest, Guide, Host, HostSearch, HostSearchMatch, JoinedVia, HostSearchStatus, HostStatus, SourceCandidate, SourceSearchStatus, Message, DirectionSlug, Practice, PracticeFormat, PracticeStatus, ServiceCategory, Product, ProductStatus, Share, Shelf, ShelfAuthor, ShelfRule, ShelfStatus, TgAccount, TicketType, TopicOrigin, User, CollectedStatus } from '@yaswami/core';
import { APPROVAL_STATUSES, CITY_LAUNCH_STATUSES, DEFAULT_CITY_ID, EVENT_KINDS, EVENT_STATUSES, IDENTITY_PROVIDERS, JOINED_VIA, PRODUCT_CATEGORY_SLUGS, PRODUCT_STATUSES, SHARE_KINDS, SOURCE_APPROVAL_STATUSES, SOURCE_KINDS, SOURCE_SEARCH_STATUSES } from '@yaswami/core';

const oneOf = (column: string, values: readonly string[]) =>
  sql.raw(`${column} in (${values.map((v) => `'${v}'`).join(', ')})`);
const telegramId = (name: string) => bigint(name, { mode: 'number' }); // id в Telegram (чата, автора, организатора): не влезают в int4
/**
 * Id нашего пользователя (users.id и ссылки на него): случайное непрозрачное число, НЕ Telegram id (ADR-0008).
 * Telegram человека — строка provider = 'telegram' в user_identities (telegramIdOf в auth.ts).
 */
const userId = (name: string) => bigint(name, { mode: 'number' });
const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable('users', {
  // Случайный, а не подряд и не Telegram id: по id нельзя перебрать пользователей или узнать, сколько их (ADR-0008).
  // 6 цифр (100000…999999) из криптостойкого gen_random_uuid(). Совпадение с занятым id возможно — signInWith тогда
  // берёт другой. ponytail: 9·10^5 вариантов; к ~100 тысячам пользователей повторы станут частыми — тогда длиннее
  // (поменять 100000 и 900000 здесь; старые id трогать не нужно).
  id: userId('id').primaryKey().default(sql`100000 + ('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 13))::bit(52)::bigint % 900000`),
  first_name: text().notNull(),
  username: text(),
  lang: text().notNull(),
  timezone: text().notNull(),
  features: jsonb().$type<Feature[]>().notNull().default([]),
  // Город человека: его витрину открывает мини-приложение, о его событиях пишет сводка по темам. Выбирает сам; у нового
  // пусто — приложение спросит, а до ответа всё идёт по первому городу.
  city_id: text().references((): AnyPgColumn => cities.id),
  // Уведомления, которые человек выключил в профиле; новое уведомление приходит, пока его не выключат.
  muted_notifications: jsonb().$type<Notification[]>().notNull().default([]),
  // Заблокировал бота: Telegram отказал в доставке (User.bot_blocked_at). Ставит журнал отправок (inbox.ts, logSent) и
  // my_chat_member (bot.ts), снимает его следующее сообщение боту.
  bot_blocked_at: at('bot_blocked_at'),
  // Бан командой (User.banned_at): admin_users_update с is_banned.
  banned_at: at('banned_at'),
});


/**
 * Способ входа (CONTEXT.md): кем человека знает внешний поставщик. Telegram — такой же поставщик: его subject —
 * Telegram id человека строкой; по этой строке бот знает, куда писать. У пользователя не больше одного способа
 * каждого поставщика. В Luma такого нет.
 */
export const userIdentities = pgTable(
  'user_identities',
  {
    provider: text({ enum: IDENTITY_PROVIDERS }).notNull(),
    subject: text().notNull(), // id человека у поставщика: Telegram id, sub из id_token Apple или Google
    user_id: userId('user_id').notNull().references(() => users.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    created_at: at('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.subject] }), uniqueIndex('user_identities_user_provider_uq').on(t.user_id, t.provider)],
);

/**
 * Приход и заходы пользователя (CONTEXT.md, «Приход»): когда и откуда пришёл в первый раз, когда заходил последний раз.
 * Отдельно от users: это знает только команда, в `/me` не уходит, и частая запись `last_seen_at` не трогает строку
 * пользователя — её снимок в журнале (audit.ts) не устаревает от каждого захода. В Luma такого нет.
 * Строку заводит первый вход (`signInWith`); у пришедших до 2026-11-26 её создала миграция с `joined_via` = null.
 */
export const userActivity = pgTable('user_activity', {
  user_id: userId('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
  created_at: at('created_at').notNull().defaultNow(), // первый вход
  joined_via: text().$type<JoinedVia>(), // JOINED_VIA; null — пришёл до того, как мы стали это записывать
  // С чем открыл в первый раз: startapp мини-приложения или хвост /start у бота — событие, кто позвал, метка (parseStart).
  start_param: text(),
  last_seen_at: at('last_seen_at'), // последний заход; пишется не чаще раза в полчаса (touchUser в auth.ts)
}, (t) => [index('user_activity_created_idx').on(t.created_at), check('user_activity_joined_via_check', oneOf('joined_via', JOINED_VIA))]);

// Подписка на темы (CONTEXT.md): строка появляется, когда человек ответил на вопрос «что интересно» — в том числе
// отказом (`topics` = []). `notified_at` — до какого момента события ему уже показаны: при подписке — её время, после
// сводки — время сводки. В Luma такого нет. Города позже встанут сюда же колонкой.
export const subscriptions = pgTable('subscriptions', {
  user_id: userId('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
  topics: jsonb().$type<string[]>().notNull(),
  notified_at: at('notified_at').notNull().defaultNow(),
});

// Город (City в @yaswami/core). `city_id` у источников, собранных событий, организаторов и событий Ясвами по умолчанию —
// первый город: так его получает всё, что было до городов, и всё, чему город не указали (в том числе записи сборщика).
export const cities = pgTable('cities', {
  id: text().primaryKey(),
  name: text().notNull(),
  timezone: text().notNull(),
  aliases: jsonb().$type<string[]>().notNull().default([]),
  latitude: doublePrecision(),
  longitude: doublePrecision(),
  // Кто публикует полки витрины (ADR-0009): draft — изменения куратора ждут команду, auto — куратор публикует сам.
  showcase_mode: text({ enum: ['draft', 'auto'] }).notNull().default('draft'),
  // archived — город на паузе: гостям не виден, сборщик его не читает (CITY_LAUNCH_STATUSES в core).
  launch_status: text({ enum: CITY_LAUNCH_STATUSES }).notNull().default('launched'),
  created_at: at('created_at').notNull().defaultNow(),
});

export const events = pgTable(
  'events',
  {
    id: text().primaryKey(),
    user_id: userId('user_id').notNull().references(() => users.id, { onUpdate: 'cascade' }), // организатор
    kind: text({ enum: EVENT_KINDS }).notNull(),
    name: text().notNull(),
    description: text(),
    start_at: at('start_at').notNull(),
    end_at: at('end_at'),
    timezone: text().notNull(),
    city_id: text().notNull().default(DEFAULT_CITY_ID).references(() => cities.id),
    geo_address_json: jsonb().$type<Address>(),
    meeting_url: text(),
    max_capacity: integer(),
    allow_plus_one: boolean().notNull().default(false),
    topic: text(),
    what_happens: jsonb().$type<string[]>().notNull().default([]),
    for_whom: text(),
    beginner_friendly: boolean(),
    takeaway: text(),
    guide: jsonb().$type<Guide>(),
    status: text({ enum: EVENT_STATUSES }).notNull().default('draft'),
    widget_id: text(),
    rev: integer().notNull().default(0),
    created_at: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('events_user_idx').on(t.user_id),
    check('events_kind_check', oneOf('kind', EVENT_KINDS)),
    check('events_status_check', oneOf('status', EVENT_STATUSES)),
    check('events_max_capacity_check', sql`${t.max_capacity} > 0`),
  ],
);

export const ticketTypes = pgTable(
  'ticket_types',
  {
    id: uuid().primaryKey().defaultRandom(),
    event_id: text().notNull().references(() => events.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    description: text(),
    max_capacity: integer(),
    is_hidden: boolean().notNull().default(false),
    price_text: text(),
    position: integer().notNull().default(0),
  },
  (t) => [
    index('ticket_types_event_idx').on(t.event_id),
    check('ticket_types_max_capacity_check', sql`${t.max_capacity} > 0`),
  ],
);

export const guests = pgTable(
  'guests',
  {
    event_id: text().notNull().references(() => events.id, { onDelete: 'cascade' }),
    user_id: userId('user_id').notNull().references(() => users.id, { onUpdate: 'cascade' }),
    approval_status: text({ enum: APPROVAL_STATUSES }).notNull(),
    // Тип с записавшимися гостями удалить нельзя.
    event_ticket_type_id: uuid().references(() => ticketTypes.id, { onDelete: 'restrict' }),
    plus_ones: integer().notNull().default(0),
    registered_at: at('registered_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.event_id, t.user_id] }),
    index('guests_user_idx').on(t.user_id),
    check('guests_approval_status_check', oneOf('approval_status', APPROVAL_STATUSES)),
    check('guests_plus_ones_check', sql`${t.plus_ones} >= 0`),
    check('guests_ticket_check', sql`${t.approval_status} not in ('approved', 'waitlist') or ${t.event_ticket_type_id} is not null`),
  ],
);

export const shares = pgTable(
  'shares',
  {
    id: uuid().primaryKey().defaultRandom(),
    event_id: text().notNull().references(() => events.id, { onDelete: 'cascade' }),
    kind: text({ enum: SHARE_KINDS }).notNull(),
    chat_id: bigint({ mode: 'number' }),
    message_id: integer(),
    inline_message_id: text(),
  },
  (t) => [index('shares_event_idx').on(t.event_id), check('shares_kind_check', oneOf('kind', SHARE_KINDS))],
);

/**
 * Область действия токена роли Hermes: с ним доступен только MCP и только перечисленные инструменты (mcp.ts), REST закрыт.
 * support — каталог и события собеседника по билету; catalog — только каталог. В Luma такого нет.
 */
export const TOKEN_SCOPES = ['support', 'catalog', 'curator', 'librarian'] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

// Токены доступа для REST и MCP вне Telegram. Храним только sha256: сам токен показывается один раз.
export const apiTokens = pgTable(
  'api_tokens',
  {
    token_hash: text().primaryKey(),
    user_id: userId('user_id').notNull().references(() => users.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    created_at: at('created_at').notNull().defaultNow(),
    // null — токен без ограничений: всё, что может его владелец.
    scope: text().$type<TokenScope>(),
    // null — бессрочный (токен для MCP-клиента, его отзывают). У сессии сайта срок тот же, что у cookie.
    expires_at: at('expires_at'),
  },
  (t) => [index('api_tokens_user_idx').on(t.user_id)],
);

// События, собранные из Telegram-каналов (apps/collector). Это ещё не события Ясвами: хозяина нет,
// данные извлечены ИИ. Пишет сюда только сборщик; форма `event` и `announcement` — в apps/collector/README.md.
export const collectedEvents = pgTable(
  'collected_events',
  {
    external_id: text().primaryKey(), // telegram:<канал>/<публикация>#<номер события в ней>
    channel: text().notNull(),
    city_id: text().notNull().default(DEFAULT_CITY_ID).references(() => cities.id),
    announcement: jsonb().$type<{ url: string; text?: string; media?: CollectedMedia[] }>().notNull(), // media — фото и видео публикации в бакете (ADR-0006)
    event: jsonb().$type<CollectedEvent>().notNull(),
    starts_at: at('starts_at').notNull(),
    ends_at: at('ends_at'),
    // Контакт для записи. По нему вошедшему организатору предлагают подтвердить событие.
    telegram_username: text(),
    // ponytail: больше не читается — ссылку записи API собирает сам (collectedSignupUrl). Сборщик ещё пишет её;
    // убрать колонку вместе с apps/collector/src/signup.mjs.
    signup_url: text().notNull(),
    // Организатор подтвердил, что событие его: из него создано настоящее событие.
    claimed_event_id: text().references(() => events.id, { onDelete: 'set null' }),
    // Отклик на публикацию-источник: сборщик обновляет каждый проход, пока событие не прошло. null — ещё не смотрел;
    // views у публикаций в группах нет вовсе. По ним считается «популярное» (popularIds в @yaswami/core).
    views: integer(),
    reactions: integer(),
    // Обложку (photos.collected_external_id) посмотрел иллюстратор: оставил фото анонса или нарисовал свою.
    // null — ещё не смотрел; такие события отдаёт covers_pending в MCP.
    cover_checked_at: at('cover_checked_at'),
    // Короткий ролик-история о событии: рисует роль illustrator в Hermes (support.ts), лежит в хранилище xAI.
    // ponytail: храним только ссылку — файл в 6–12 МБ в Postgres класть не стоит; если xAI начнёт брать деньги
    // за хранение или ссылки протухнут, переносить в объектное хранилище.
    video_url: text(),
    // Когда ролик заказали: по этой отметке считается дневной лимит (генерация платная), и второй раз не заказываем.
    video_at: at('video_at'),
    // Сколько раз ролик заказывали. Заказ живёт в памяти процесса API: перезапуск (выкладка) обрывает его,
    // и результат теряется — такой заказ повторяем, но не больше VIDEO_TRIES раз, чтобы не рисовать по кругу.
    video_tries: integer().notNull().default(0),
    // Модерация (CollectedStatus в @yaswami/core): pending — ждёт решения в админке, approved — одобрено и ждёт
    // обработки иллюстратором, published — в ленте, rejected — отклонено или снято с публикации. В ленту и на
    // страницу события попадает только published. Отклонённое остаётся в базе: повторный анонс не создаст его заново.
    status: text().$type<CollectedStatus>().notNull().default('pending'),
    // Когда событие впервые вышло в ленту: по нему сводка подписчикам отличает новое. Ставит сама сводка
    // (subscriptions.ts) — путей в published несколько; повторная публикация после снятия отметку не меняет.
    published_at: at('published_at'),
    created_at: at('created_at').notNull().defaultNow(),
    updated_at: at('updated_at').notNull().defaultNow(),
  },
  (t) => [index('collected_events_starts_idx').on(t.starts_at), index('collected_events_username_idx').on(t.telegram_username)],
);

// Организатор собранного события (Host в Luma API). Профиль собирает сборщик: по контакту из анонса находит человека
// в Telegram, берёт имя и «о себе», его канал и сводку ИИ по каналу.
export const hosts = pgTable(
  'hosts',
  {
    id: uuid().primaryKey().defaultRandom(),
    // Пользователь Ясвами, если этот человек вошёл: профиль подтверждён. null — собран без его участия.
    user_id: userId('user_id').references(() => users.id, { onDelete: 'set null', onUpdate: 'cascade' }),
    // Кто это в Telegram: по этому id профиль привязывается к пользователю при входе. Отдельно от user_id:
    // пользователи со временем будут не только из Telegram.
    // null — организатора добавила команда по username (admin_hosts_create), сборщик ещё не нашёл его в Telegram.
    telegram_id: telegramId('telegram_id').unique(),
    username: text().notNull(), // без @, в нижнем регистре; по нему профиль находится от collected_events.telegram_username
    name: text().notNull(),
    city_id: text().notNull().default(DEFAULT_CITY_ID).references(() => cities.id),
    bio: text(),
    channel: text(), // username канала: личный канал из профиля или ссылка из «о себе»
    instagram_handle: text(), // ник в Instagram без @, в нижнем регистре; имя — как у Host в Luma. Ставит команда
    summary: text(),
    // Модерация (HOST_STATUSES): новые — pending; отклонённый не виден целиком. Что он ведёт без даты — в таблице practices.
    status: text().$type<HostStatus>().notNull().default('pending'),
    feedback_bonus: text(), // что мастер обещает гостю за отзыв, его словами (hosts_update_self)
    offer_url: text(), // сообщение, из которого сборщик взял мастера
    // Фото сообщества, новые сверху: последние картинки канала. Файлы — в бакете R2, здесь только адреса (ADR-0006).
    photos: jsonb().$type<{ source: string; url: string }[]>().notNull().default([]),
    // Когда сборщик последний раз смотрел фото в канале; null — ещё не смотрел. Фото может и не оказаться.
    photos_checked_at: at('photos_checked_at'),
    // Когда сборщик последний раз смотрел профиль в Telegram (bio, канал); раз в PROFILE_REFRESH_DAYS смотрит снова.
    profiled_at: at('profiled_at'),
    created_at: at('created_at').notNull().defaultNow(),
  },
  (t) => [index('hosts_username_idx').on(t.username)],
);

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

// Фото, которые храним у себя, — прямо в базе (ADR-0003). Только превью: JPEG ~320px, десятки килобайт, без оригиналов.
// У пользователя фото одно (его аватар в Telegram). Фото сообщества организатора — в бакете, адресами в hosts.photos.
// Строка не меняется: новое фото — новая строка с новым id, поэтому адрес /photos/<id> кэшируется навсегда.
export const photos = pgTable(
  'photos',
  {
    id: uuid().primaryKey().defaultRandom(),
    user_id: userId('user_id').unique().references(() => users.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    // Обложка собранного события, одна на событие: фото анонса или картинка, нарисованная иллюстратором.
    collected_external_id: text().unique().references(() => collectedEvents.external_id, { onDelete: 'cascade' }),
    // Обложка события «Я с вами», одна на событие: нарисованная иллюстратором, когда организатор свою не дал.
    event_id: text().unique().references(() => events.id, { onDelete: 'cascade' }),
    source: text().notNull(), // откуда взято: адрес аватара или telegram:<канал>/<публикация>; по нему не качаем повторно
    // Байты лежат либо здесь, либо в бакете R2 (url — открытый адрес файла). Обложки уходят в бакет, аватары — здесь (ADR-0011).
    data: bytea(),
    url: text(),
    created_at: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('photos_owner_check', sql`num_nonnulls(${t.user_id}, ${t.collected_external_id}, ${t.event_id}) = 1`),
    check('photos_place_check', sql`num_nonnulls(${t.data}, ${t.url}) = 1`),
  ],
);

// «Записаться» на собранное событие: фиксируем намерение и отправляем человека к организатору.
export const collectedEventSignups = pgTable(
  'collected_event_signups',
  {
    external_id: text().notNull().references(() => collectedEvents.external_id, { onDelete: 'cascade' }),
    user_id: userId('user_id').notNull().references(() => users.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    created_at: at('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.external_id, t.user_id] }), index('collected_event_signups_user_idx').on(t.user_id)],
);

// Practice (@yaswami/core): что организатор ведёт без даты — занятия, услуга мастера. Сборщик берёт их из его
// самопредставления в чате (offers.mjs); у тех, кто найден только по событиям, их нет. Каждую команда одобряет отдельно.
export const practices = pgTable(
  'practices',
  {
    id: uuid().primaryKey().defaultRandom(),
    host_id: uuid().notNull().references(() => hosts.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    topic: text().notNull(), // ключ TOPIC_GUIDES или OTHER_TOPIC
    description: text(),
    price: text(),
    // Модерация (PRACTICE_STATUSES): в каталоге видна только published.
    status: text().$type<PracticeStatus>().notNull().default('pending'),
    // Разбор услуги (сборщик): null в formats — ещё не разобрана, сборщик возьмёт её в следующий проход.
    formats: text().array().$type<PracticeFormat[]>(),
    category: text().$type<ServiceCategory>(), // SERVICE_CATEGORIES; null — не размечена (ADR-0012)
    for_kids: boolean(),
    price_amount: bigint({ mode: 'number' }),
    price_currency: text(),
    position: integer().notNull().default(0), // порядок у организатора: как назвал сам или как расставила команда
    created_at: at('created_at').notNull().defaultNow(),
  },
  (t) => [index('practices_host_idx').on(t.host_id)],
);

// «Записаться» на Practice мастера: фиксируем намерение и отправляем человека к мастеру.
// `host_id` повторяет practices.host_id: по нему записи входят в снимок организатора в журнале (audit.ts).
// ponytail: без статуса и подтверждения — пока мастера не входят в Ясвами. Был ли визит, узнаём у гостя (practice_feedback).
export const practiceSignups = pgTable(
  'practice_signups',
  {
    practice_id: uuid().notNull().references(() => practices.id, { onDelete: 'cascade' }),
    host_id: uuid().notNull().references(() => hosts.id, { onDelete: 'cascade' }),
    user_id: userId('user_id').notNull().references(() => users.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    created_at: at('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.practice_id, t.user_id] }), index('practice_signups_user_idx').on(t.user_id), index('practice_signups_host_idx').on(t.host_id)],
);

// Полка витрины города (core/shelves.ts, ADR-0009): правило или ручной список собранных событий. Правят команда и куратор.
// Товар мастера (Product в @yaswami/core): то, что мастер сам делает и продаёт. Пишет сборщик из источников вида products,
// команда одобряет в «Каталоге». Город — город мастера. Гость видит published не старше PRODUCT_TTL_DAYS от posted_at.
export const products = pgTable(
  'products',
  {
    id: uuid().primaryKey().defaultRandom(),
    host_id: uuid().notNull().references(() => hosts.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    description: text(),
    price: text(),
    unit: text(),
    category: text({ enum: PRODUCT_CATEGORY_SLUGS }).notNull(), // категория товара (PRODUCT_CATEGORIES, ADR-0013)
    photo_url: text(),
    announcement: jsonb().$type<Product['announcement']>().notNull(),
    title_key: text().notNull(),
    status: text().$type<ProductStatus>().notNull().default('pending'),
    posted_at: at('posted_at').notNull().defaultNow(),
    created_at: at('created_at').notNull().defaultNow(),
    updated_at: at('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // Повтор — тот же товар у того же мастера: сборщик обновляет цену, фото и posted_at, а не пишет вторую строку.
    uniqueIndex('products_host_title_idx').on(t.host_id, t.title_key),
    index('products_list_idx').on(t.status, t.posted_at),
    check('products_status_check', oneOf('status', PRODUCT_STATUSES)),
    check('products_category_check', oneOf('category', PRODUCT_CATEGORY_SLUGS)),
  ],
);

export const shelves = pgTable(
  'shelves',
  {
    id: uuid().primaryKey().defaultRandom(),
    city_id: text().notNull().references(() => cities.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    topic: text(),
    rule: jsonb().$type<ShelfRule>(),
    event_ids: jsonb().$type<string[]>().notNull().default([]),
    position: integer().notNull().default(0),
    status: text().$type<ShelfStatus>().notNull().default('published'),
    pinned: boolean().notNull().default(false),
    author: text().$type<ShelfAuthor>().notNull(),
    note: text(),
    ends_at: at('ends_at'),
    created_at: at('created_at').notNull().defaultNow(),
    updated_at: at('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('shelves_city_idx').on(t.city_id, t.position),
    check('shelves_status_check', sql`${t.status} in ('proposed', 'published', 'hidden')`),
    check('shelves_author_check', sql`${t.author} in ('team', 'curator')`),
  ],
);

// Запрос организатора: каких людей он ищет в больших чатах (core/host-searches.ts). Ключевые слова выводит сборщик.
export const hostSearches = pgTable(
  'host_searches',
  {
    id: uuid().primaryKey().defaultRandom(),
    host_id: uuid().notNull().references(() => hosts.id, { onDelete: 'cascade' }),
    query: text().notNull(),
    status: text().$type<HostSearchStatus>().notNull().default('active'),
    keywords: text().array(), // null — сборщик ещё не вывел; сбрасывается при смене query
    created_at: at('created_at').notNull().defaultNow(),
  },
  (t) => [index('host_searches_host_idx').on(t.host_id), check('host_searches_status_check', sql`${t.status} in ('suggested', 'active', 'paused')`)],
);

// Находка по Запросу: сообщение из чата, подошедшее по мнению ИИ. Пишет сборщик (store.mjs, saveSearchMatch).
export const hostSearchMatches = pgTable(
  'host_search_matches',
  {
    id: uuid().primaryKey().defaultRandom(),
    search_id: uuid().notNull().references(() => hostSearches.id, { onDelete: 'cascade' }),
    chat: text().notNull(),
    message_id: integer().notNull(),
    url: text().notNull(),
    author_id: telegramId('author_id').notNull(),
    author_name: text().notNull(),
    author_username: text(),
    text: text().notNull(),
    sent_at: at('sent_at').notNull(),
    created_at: at('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('host_search_matches_message_idx').on(t.search_id, t.chat, t.message_id), index('host_search_matches_created_idx').on(t.created_at)],
);

// Аудитория организатора — contacts календаря в Luma API. Организатор у нас — пользователь (events.user_id).
// Сюда же лягут метки, блокировки и отписки, когда появятся рассылки.
export const contacts = pgTable(
  'contacts',
  {
    id: uuid().primaryKey().defaultRandom(),
    host_user_id: userId('host_user_id').notNull().references(() => users.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    user_id: userId('user_id').notNull().references(() => users.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    created_at: at('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('contacts_host_user_idx').on(t.host_user_id, t.user_id)],
);

// Заход вошедшего пользователя на событие — своё или собранное. Строка на каждый заход: по ним считается аудитория
// организатора (events.user_id; у собранных — hosts по telegram_username) и кто кого привёл (referrer_id).
// ponytail: журнал без свёртки; когда вырастет — сворачивать в (user, событие, первый/последний заход).
export const visits = pgTable(
  'visits',
  {
    id: uuid().primaryKey().defaultRandom(),
    user_id: userId('user_id').notNull().references(() => users.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    event_id: text().references(() => events.id, { onDelete: 'cascade' }),
    collected_external_id: text().references(() => collectedEvents.external_id, { onDelete: 'cascade' }),
    // Кто позвал: пользователь, чьей ссылкой «Позвать друзей» открыли событие.
    referrer_id: userId('referrer_id').references(() => users.id, { onDelete: 'set null', onUpdate: 'cascade' }),
    created_at: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('visits_event_idx').on(t.event_id),
    index('visits_collected_idx').on(t.collected_external_id),
    index('visits_user_idx').on(t.user_id),
    index('visits_referrer_idx').on(t.referrer_id),
    check('visits_target_check', sql`num_nonnulls(${t.event_id}, ${t.collected_external_id}) = 1`),
  ],
);

// Topic (CONTEXT.md): тема и гид по ней. Первые темы завела миграция (те же, что в TOPIC_GUIDES ядра), дальше список
// правят команда и агенты (admin/topics.ts), сборщик добавляет темы по накопившимся Tag (store.mjs). В Luma такого нет.
export const topics = pgTable('topics', {
  name: text().primaryKey(), // ключ: он же стоит в событиях и услугах (`topic`), поэтому не переименовывается
  slug: text().notNull().unique(), // латиницей: адрес иконки и ключ цвета на сайте
  emoji: text().notNull(),
  color: text().notNull(), // #rrggbb
  what: text().notNull(),
  why: text().notNull(),
  first: text().notNull(),
  not_for: text().notNull(),
  // Tag, которые означают эту тему: события и услуги без темы («другое») с такой меткой переходят в неё.
  tags: jsonb().$type<string[]>().notNull().default([]),
  // Выключенная тема не предлагается ни людям, ни сборщику. Строку не удаляем: события хранят её имя.
  enabled: boolean().notNull().default(true),
  origin: text().$type<TopicOrigin>().notNull().default('team'),
  // Направление (DIRECTIONS в core/topics.ts): крупный раздел, с которого человек начинает искать. null — ещё ни в каком.
  direction: text().$type<DirectionSlug>(),
  position: integer().notNull().default(0), // порядок в фильтрах
  // Иконка 192×192 PNG: рисует роль illustrator или загружает команда. У первых тем её нет — файл в сборке сайта.
  icon: bytea(),
  icon_at: at('icon_at'), // когда иконку меняли: стоит в её адресе, чтобы кэш не держал старую
  icon_tries: integer().notNull().default(0), // сколько раз просили иллюстратора: после ICON_TRIES не просим
  created_at: at('created_at').notNull().defaultNow(),
});

// Source: канал или группа, откуда сборщик берёт анонсы. Пишут сюда сборщик (CHANNELS при старте, каналы организаторов
// каждый проход) и команда из админки. В Luma такого нет.
export const sources = pgTable(
  'sources',
  {
    channel: text().primaryKey(), // как в collected_events.channel и collector_cursors: username без @ или id закрытого чата (-100…)
    // Организатор источника: сборщик ставит его, когда берёт канал из профиля, команда — в админке; null — не указан.
    host_id: uuid().references(() => hosts.id, { onDelete: 'set null' }),
    // Выключенный источник сборщик не читает. Строку не удаляем: иначе канал организатора добавился бы снова.
    enabled: boolean().notNull().default(true),
    city_id: text().notNull().default(DEFAULT_CITY_ID).references(() => cities.id),
    // Что сборщик берёт из чата: анонсы событий или вопросы и мастеров (бывший LEAD_CHATS).
    kind: text({ enum: SOURCE_KINDS }).notNull().default('announcements'),
    // Почему выключен сборщиком: канала больше нет в Telegram или он стал закрытым. null — выключила команда или включён.
    disabled_reason: text(),
    // Сколько публикаций подряд ИИ разобрал и не нашёл ни одного события: найдено — снова 0. Набралось
    // SOURCE_EMPTY_PARSES (20) — сборщик выключает источник: каждый разбор — запрос к ИИ. Команда включила — снова 0.
    empty_parses: integer('empty_parses').notNull().default(0),
    // Источник, который предложил человек (sources_add), ждёт решения команды выключенным: pending_approval → approved
    // или declined. Отклонённый остаётся строкой, чтобы его не предложили снова. Команда и сборщик пишут сразу approved.
    approval_status: text({ enum: SOURCE_APPROVAL_STATUSES }).notNull().default('approved'),
    // Кто предложил: по нему считается лимит SOURCES_PER_DAY, ему бот пишет, когда команда одобрила. null — команда или сборщик.
    submitted_by: userId('submitted_by').references(() => users.id, { onDelete: 'set null', onUpdate: 'cascade' }),
    created_at: at('created_at').notNull().defaultNow(),
  },
  // Username в Telegram не различает регистр: @Tea и @tea — один канал.
  (t) => [uniqueIndex('sources_channel_lower_idx').on(sql`lower(${t.channel})`)],
);

// Поиск источников для города (SourceSearch в @yaswami/core): команда ставит в очередь, сборщик ищет и пишет results.
// Пишет сюда API (заявка) и сборщик (ход и итог).
export const sourceSearches = pgTable('source_searches', {
  id: uuid().primaryKey().defaultRandom(),
  city_id: text().notNull().references(() => cities.id),
  names: jsonb().$type<string[]>().notNull(),
  status: text({ enum: SOURCE_SEARCH_STATUSES }).$type<SourceSearchStatus>().notNull().default('queued'),
  error: text(),
  // Без `added`: его API считает при выдаче, по источникам на тот момент.
  results: jsonb().$type<Omit<SourceCandidate, 'added'>[]>().notNull().default([]),
  created_at: at('created_at').notNull().defaultNow(),
  finished_at: at('finished_at'),
});

// Каналы и группы, которые читающий аккаунт сборщика уже нашёл по username: id и access_hash. При старте сборщик
// кладёт их в сессию GramJS, чтобы не искать заново: поиск по username (contacts.ResolveUsername) Telegram ограничивает
// в сутки, а GramJS помнит найденное только до перезапуска. access_hash действителен только для своего аккаунта —
// отсюда `account` (Telegram id читающего аккаунта). Пишет и читает только сборщик. В Luma такого нет.
export const tgPeers = pgTable('tg_peers', {
  account: text().notNull(),
  username: text().notNull(), // в нижнем регистре, как его хранит GramJS
  peer_id: text().notNull(), // -100… у каналов и групп
  access_hash: text().notNull(),
  updated_at: at('updated_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.account, t.username] })]);

// Номер последней разобранной публикации по каждому источнику сборщика.
export const collectorCursors = pgTable('collector_cursors', {
  channel: text().primaryKey(),
  last_number: integer().notNull(),
});

// Аккаунты Telegram, с которых мы пишем людям. `session` (зашифрована ключом сборщика) и `login` (код и пароль
// на время входа) читает и пишет только сборщик; API отдаёт наружу остальные поля.
export const tgAccounts = pgTable('tg_accounts', {
  id: uuid().primaryKey().defaultRandom(),
  label: text().notNull(),
  phone: text().notNull().unique(),
  status: text().$type<TgAccount['status']>().notNull().default('login_requested'),
  last_error: text(),
  // Сколько первых сообщений за сутки (диалоги, где человек нам ещё не писал). Ответы не считаются (docs/agents-inbox.md).
  daily_limit: integer().notNull().default(20),
  // Пауза первых сообщений после PEER_FLOOD (сборщик ставит, команда может снять): TgAccount.cold_paused_until.
  cold_paused_until: at('cold_paused_until'),
  created_at: at('created_at').notNull().defaultNow(),
  session: text(),
  // `sealed` — код или пароль, зашифрованные ключом сборщика (ACCOUNTS_KEY у API). Открытым текстом API их не пишет.
  login: jsonb().$type<{ sealed?: string }>(),
});

// Переписка с людьми (docs/agents-inbox.md): всё, что человек написал боту или на наш аккаунт и что мы ответили.
export const conversations = pgTable(
  'conversations',
  {
    id: uuid().primaryKey().defaultRandom(),
    channel: text().$type<Conversation['channel']>().notNull(),
    account_id: uuid().references(() => tgAccounts.id, { onDelete: 'set null' }),
    peer_id: telegramId('peer_id').notNull(),
    peer_name: text().notNull(),
    peer_username: text(),
    mode: text().$type<Conversation['mode']>().notNull().default('agent'),
    attention: text(),
    hidden_at: at('hidden_at'),
    last_message_at: at('last_message_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('conversations_peer_idx').on(t.channel, t.peer_id), index('conversations_last_idx').on(t.last_message_at)],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid().primaryKey().defaultRandom(),
    conversation_id: uuid().notNull().references(() => conversations.id, { onDelete: 'cascade' }),
    direction: text().$type<Message['direction']>().notNull(),
    author: text().notNull(),
    text: text().notNull(),
    status: text().$type<Message['status']>().notNull(),
    meta: jsonb().$type<Message['meta']>(),
    created_at: at('created_at').notNull().defaultNow(),
  },
  (t) => [index('messages_conversation_idx').on(t.conversation_id, t.created_at), index('messages_created_idx').on(t.created_at)],
);

// Отзыв гостя о прошедшем событии (feedback.ts). Строка появляется, когда бот попросил отзыв; оценки ещё нет — rating null.
export const eventFeedback = pgTable(
  'event_feedback',
  {
    event_id: text().notNull().references(() => events.id, { onDelete: 'cascade' }),
    user_id: userId('user_id').notNull().references(() => users.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    rating: integer(), // 1–5
    comment: text(),
    // Сообщение бота «что понравилось…»: ответ на него становится текстом отзыва.
    prompt_message_id: integer(),
    // Отзыв уже ушёл организатору в сводке; новая оценка или текст сбрасывают отметку.
    host_notified_at: at('host_notified_at'),
    requested_at: at('requested_at').notNull().defaultNow(),
    updated_at: at('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.event_id, t.user_id] }), check('event_feedback_rating_check', sql`${t.rating} between 1 and 5`)],
);

// Отзыв на услугу мастера (practice-feedback.ts; в Luma такого нет). Строка появляется, когда бот спросил «были?»
// через сутки после записи (`via: signup`) или когда человек пришёл к боту по ссылке мастера (`via: invite`).
// `host_id` повторяет practices.host_id: по нему отзывы входят в снимок организатора в журнале и считается репутация.
export const practiceFeedback = pgTable(
  'practice_feedback',
  {
    practice_id: uuid().notNull().references(() => practices.id, { onDelete: 'cascade' }),
    host_id: uuid().notNull().references(() => hosts.id, { onDelete: 'cascade' }),
    user_id: userId('user_id').notNull().references(() => users.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    via: text().$type<FeedbackVia>().notNull(),
    attended: boolean(), // был ли у мастера: null — ответа нет, false — не дошёл; оценка есть только у того, кто был
    rating: integer(), // 1–5
    comment: text(),
    // Сообщение, где человек написал отзыв: прислал ссылкой (сверяет команда, до того verified_at null) или переслал из канала.
    source_url: text(),
    verified_at: at('verified_at'),
    prompt_message_id: integer(), // сообщение бота «пара слов…»: ответ на него становится текстом отзыва
    host_notified_at: at('host_notified_at'), // отзыв уже ушёл мастеру в сводке; новая оценка или текст сбрасывают отметку
    requested_at: at('requested_at').notNull().defaultNow(),
    updated_at: at('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.practice_id, t.user_id] }), index('practice_feedback_host_idx').on(t.host_id),
    check('practice_feedback_rating_check', sql`${t.rating} between 1 and 5`),
    check('practice_feedback_via_check', sql`${t.via} in ('signup', 'invite')`),
  ],
);

// Журнал действий команды (audit.ts, ADR-0004): каждое изменение из админки и через admin_* в MCP, со снимками
// сущности до и после — по ним действие отменяется. Без внешних ключей: строка журнала переживает и сущность, и автора.
export const adminActions = pgTable(
  'admin_actions',
  {
    id: uuid().primaryKey().defaultRandom(),
    created_at: at('created_at').notNull().defaultNow(),
    actor_id: userId('actor_id').notNull(),
    via: text().$type<AdminAction['via']>().notNull(),
    action: text().notNull(),
    entity: text().$type<AdminEntity>().notNull(),
    entity_id: text().notNull(),
    input: jsonb().$type<unknown>(),
    before: jsonb().$type<unknown>(),
    after: jsonb().$type<unknown>(),
    undoable: boolean().notNull(),
    undo_of: uuid(),
    undone_by: uuid(),
  },
  (t) => [
    index('admin_actions_created_idx').on(t.created_at, t.id),
    index('admin_actions_entity_idx').on(t.entity, t.entity_id),
    check('admin_actions_via_check', sql`${t.via} in ('admin', 'mcp')`),
  ],
);

// Сверка с ядром: типы должны совпадать в обе стороны.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const tablesMatchCore: [
  Same<typeof users.$inferSelect, User>,
  Same<typeof events.$inferSelect, Event>,
  Same<typeof ticketTypes.$inferSelect, TicketType>,
  Same<typeof guests.$inferSelect, Guest>,
  Same<typeof shares.$inferSelect, Share>,
  Same<typeof conversations.$inferSelect, Conversation>,
  Same<typeof messages.$inferSelect, Message>,
  Same<typeof hosts.$inferSelect, Host>,
  Same<typeof adminActions.$inferSelect, AdminAction>,
  Same<typeof cities.$inferSelect, City>,
  Same<Omit<typeof practices.$inferSelect, 'host_id' | 'position' | 'created_at'>, Practice>,
  Same<typeof hostSearches.$inferSelect, HostSearch>,
  Same<typeof hostSearchMatches.$inferSelect, HostSearchMatch>,
  Same<typeof shelves.$inferSelect, Shelf>,
  Same<typeof products.$inferSelect, Product>,
] = [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true];
