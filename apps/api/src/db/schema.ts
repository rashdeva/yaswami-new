// Таблицы Postgres. Источник правды — схемы в @yaswami/core; блок в конце файла роняет typecheck,
// если строка таблицы разошлась с типом из ядра.
import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { Address, CollectedEvent, Event, Guest, Share, TicketType, User } from '@yaswami/core';
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
    announcement: jsonb().$type<{ url: string }>().notNull(),
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
    created_at: at('created_at').notNull().defaultNow(),
    updated_at: at('updated_at').notNull().defaultNow(),
  },
  (t) => [index('collected_events_starts_idx').on(t.starts_at), index('collected_events_username_idx').on(t.telegram_username)],
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

// Номер последней разобранной публикации по каждому источнику сборщика.
export const collectorCursors = pgTable('collector_cursors', {
  channel: text().primaryKey(),
  last_number: integer().notNull(),
});

// Сверка с ядром: типы должны совпадать в обе стороны.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const tablesMatchCore: [
  Same<typeof users.$inferSelect, User>,
  Same<typeof events.$inferSelect, Event>,
  Same<typeof ticketTypes.$inferSelect, TicketType>,
  Same<typeof guests.$inferSelect, Guest>,
  Same<typeof shares.$inferSelect, Share>,
] = [true, true, true, true, true];
