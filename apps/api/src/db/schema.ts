// Таблицы Postgres. Источник правды — схемы в @yaswami/core; блок в конце файла роняет typecheck,
// если строка таблицы разошлась с типом из ядра.
import { sql } from 'drizzle-orm';
import { bigint, boolean, check, customType, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { Address, CollectedEvent, Conversation, Event, Guest, Guide, Message, Share, TgAccount, TicketType, User, CollectedStatus } from '@yaswami/core';
import { APPROVAL_STATUSES, EVENT_KINDS, EVENT_STATUSES, SHARE_KINDS } from '@yaswami/core';

const oneOf = (column: string, values: readonly string[]) =>
  sql.raw(`${column} in (${values.map((v) => `'${v}'`).join(', ')})`);
const telegramId = (name: string) => bigint(name, { mode: 'number' }); // id Telegram не влезают в int4
const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable('users', {
  id: telegramId('id').primaryKey(),
  first_name: text().notNull(),
  username: text(),
  lang: text().notNull(),
  timezone: text().notNull(),
});

export const events = pgTable(
  'events',
  {
    id: text().primaryKey(),
    user_id: telegramId('user_id').notNull().references(() => users.id), // организатор
    kind: text({ enum: EVENT_KINDS }).notNull(),
    name: text().notNull(),
    description: text(),
    start_at: at('start_at').notNull(),
    end_at: at('end_at'),
    timezone: text().notNull(),
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
    user_id: telegramId('user_id').notNull().references(() => users.id),
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

// Токены доступа для REST и MCP вне Telegram. Храним только sha256: сам токен показывается один раз.
export const apiTokens = pgTable(
  'api_tokens',
  {
    token_hash: text().primaryKey(),
    user_id: telegramId('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    created_at: at('created_at').notNull().defaultNow(),
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
    announcement: jsonb().$type<{ url: string; text?: string }>().notNull(),
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
    user_id: telegramId('user_id').references(() => users.id, { onDelete: 'set null' }),
    // Кто это в Telegram: по этому id профиль привязывается к пользователю при входе. Отдельно от user_id:
    // пользователи со временем будут не только из Telegram.
    telegram_id: telegramId('telegram_id').notNull().unique(),
    username: text().notNull(), // без @, в нижнем регистре; по нему профиль находится от collected_events.telegram_username
    name: text().notNull(),
    bio: text(),
    channel: text(), // username канала: личный канал из профиля или ссылка из «о себе»
    summary: text(),
    // Когда сборщик последний раз смотрел фото в канале; null — ещё не смотрел. Фото может и не оказаться.
    photos_checked_at: at('photos_checked_at'),
    created_at: at('created_at').notNull().defaultNow(),
  },
  (t) => [index('hosts_username_idx').on(t.username)],
);

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

// Фото, которые храним у себя, — прямо в базе (ADR-0003). Только превью: JPEG ~320px, десятки килобайт, без оригиналов.
// У пользователя фото одно (его аватар в Telegram), у организатора — несколько последних картинок из его канала.
// Строка не меняется: новое фото — новая строка с новым id, поэтому адрес /photos/<id> кэшируется навсегда.
export const photos = pgTable(
  'photos',
  {
    id: uuid().primaryKey().defaultRandom(),
    user_id: telegramId('user_id').unique().references(() => users.id, { onDelete: 'cascade' }),
    host_id: uuid().references(() => hosts.id, { onDelete: 'cascade' }),
    // Обложка собранного события, одна на событие: фото анонса или картинка, нарисованная иллюстратором.
    collected_external_id: text().unique().references(() => collectedEvents.external_id, { onDelete: 'cascade' }),
    source: text().notNull(), // откуда взято: адрес аватара или telegram:<канал>/<публикация>; по нему не качаем повторно
    data: bytea().notNull(),
    created_at: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('photos_host_source_idx').on(t.host_id, t.source),
    check('photos_owner_check', sql`num_nonnulls(${t.user_id}, ${t.host_id}, ${t.collected_external_id}) = 1`),
  ],
);

// «Записаться» на собранное событие: фиксируем намерение и отправляем человека к организатору.
export const collectedEventSignups = pgTable(
  'collected_event_signups',
  {
    external_id: text().notNull().references(() => collectedEvents.external_id, { onDelete: 'cascade' }),
    user_id: telegramId('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    created_at: at('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.external_id, t.user_id] }), index('collected_event_signups_user_idx').on(t.user_id)],
);

// Аудитория организатора — contacts календаря в Luma API. Организатор у нас — пользователь (events.user_id).
// Сюда же лягут метки, блокировки и отписки, когда появятся рассылки.
export const contacts = pgTable(
  'contacts',
  {
    id: uuid().primaryKey().defaultRandom(),
    host_user_id: telegramId('host_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    user_id: telegramId('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
    user_id: telegramId('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    event_id: text().references(() => events.id, { onDelete: 'cascade' }),
    collected_external_id: text().references(() => collectedEvents.external_id, { onDelete: 'cascade' }),
    // Кто позвал: пользователь, чьей ссылкой «Позвать друзей» открыли событие.
    referrer_id: telegramId('referrer_id').references(() => users.id, { onDelete: 'set null' }),
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

// Source: канал или группа, откуда сборщик берёт анонсы. Пишут сюда сборщик (CHANNELS при старте, каналы организаторов
// каждый проход) и команда из админки. В Luma такого нет.
export const sources = pgTable(
  'sources',
  {
    channel: text().primaryKey(), // как в collected_events.channel и collector_cursors: username без @ или id закрытого чата (-100…)
    // Организатор, из профиля которого взят канал; null — источник добавила команда.
    host_id: uuid().references(() => hosts.id, { onDelete: 'set null' }),
    // Выключенный источник сборщик не читает. Строку не удаляем: иначе канал организатора добавился бы снова.
    enabled: boolean().notNull().default(true),
    created_at: at('created_at').notNull().defaultNow(),
  },
  // Username в Telegram не различает регистр: @Tea и @tea — один канал.
  (t) => [uniqueIndex('sources_channel_lower_idx').on(sql`lower(${t.channel})`)],
);

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
  created_at: at('created_at').notNull().defaultNow(),
  session: text(),
  login: jsonb().$type<{ secret?: string }>(),
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
    user_id: telegramId('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
] = [true, true, true, true, true, true, true];
