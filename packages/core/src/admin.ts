// Операции команды над всем сервисом (`admin_*` в MCP, `/admin/*` в REST) и журнал этих действий: формы входа и ответа.
import * as z from 'zod';
import type { AdminCollectedEvent, EventView, Practice } from './api.ts';
import { cityId, dateTime, EventCreateInput, EventUpdateInput, timeZone } from './api.ts';
import type { Event, Guest, User } from './schema.ts';
import { City, Feature, RsvpStatus, User as UserSchema } from './schema.ts';

const text = (max: number) => z.string().trim().max(max);
// Сервис сам убирает @ и приводит к нижнему регистру (normalUsername): преобразование в схеме не описать в JSON Schema для MCP.
const username = z.string().trim().regex(/^@?\w{4,32}$/, 'telegram username');
/** Username Telegram так, как он хранится: без @, в нижнем регистре. */
export const normalUsername = <T extends string | null | undefined>(u: T): T => (u ? u.replace(/^@/, '').toLowerCase() : u) as T;

// --- События Ясвами

/** Отбор событий: `after` и `before` — как у `calendars/events/list` в Luma; `query` — наше: часть названия. */
export const AdminEventListInput = z.object({
  after: dateTime.optional().describe('Only events starting after this moment; pass the current time for upcoming events'),
  before: dateTime.optional().describe('Only events starting before this moment; pass the current time for past events'),
  query: text(60).min(1).optional().describe('Part of the event name'),
});
export type AdminEventListInput = z.infer<typeof AdminEventListInput>;

export interface AdminEventItem {
  event: Event;
  host_id: User['id'];
  host_name: string;
  host_username: string | null;
  url: string; // событие в приложении
}

/** Событие глазами его организатора (видны и отказавшиеся) и ссылка на него. */
export interface AdminEventView extends EventView {
  url: string;
}

/** Событие от имени пользователя: `user_id` — организатор; его лимит бесплатных событий действует. */
export const AdminEventCreateInput = EventCreateInput.extend({
  user_id: UserSchema.shape.id.describe('Telegram id of the host (admin_users_search)'),
  city_id: cityId.optional(),
});
export type AdminEventCreateInput = z.infer<typeof AdminEventCreateInput>;

/** Правка события командой: всё, что правит организатор, и город — его организатор пока не выбирает. */
export const AdminEventUpdateInput = EventUpdateInput.extend({ city_id: cityId.optional() });
export type AdminEventUpdateInput = z.infer<typeof AdminEventUpdateInput>;

/** Гость в глазах команды — как Guest в Luma (`user_id`, `user_first_name`); `user_username` — наше. */
export interface AdminGuest extends Guest {
  user_first_name: string;
  user_username: string | null;
}

/** Ответ за гостя — как `events/guests/update-status` в Luma, плюс билет и «+1» (в Luma такого нет). Правила мест — те же. */
export const AdminGuestUpdateInput = z.object({
  approval_status: RsvpStatus,
  event_ticket_type_id: z.string().optional().describe('Ticket type id; hidden types are allowed. Omit to keep the current one'),
  plus_ones: z.number().int().min(0).max(10).optional().describe('Extra seats; only if the event allows +1. Omit to keep'),
});
export type AdminGuestUpdateInput = z.infer<typeof AdminGuestUpdateInput>;

/** Отзыв гостя о прошедшем событии (в Luma такого нет). */
export interface AdminFeedback {
  event_id: Event['id'];
  user_id: User['id'];
  user_first_name: string;
  user_username: string | null;
  rating: number | null; // 1–5; null — бот спросил, ответа нет
  comment: string | null;
  requested_at: Date;
  updated_at: Date;
}

// --- Собранные события (в Luma такого нет)

/**
 * Правка собранного события: поля анонса (`CollectedEvent`) и решение модератора. Переданное меняется, остальное
 * остаётся. `status: approved` — в очередь обработки и в ленту, `rejected` — скрыть отовсюду.
 */
export const CollectedUpdateInput = z
  .object({
    title: text(200).min(1),
    description: text(5000),
    starts_at: dateTime,
    ends_at: dateTime.nullable(),
    place: text(200).nullable(),
    address: text(300).nullable(),
    price: text(200).nullable(),
    tags: z.array(text(40).min(1)).max(20),
    telegram_username: username.nullable().describe('Contact for sign-up, without @'),
    whatsapp_phone: text(30).nullable(),
    url: z.url({ protocol: /^https?$/ }).nullable(),
    topic: text(60),
    what_happens: z.array(text(200).min(1)).max(10),
    for_whom: text(300).nullable(),
    beginner_friendly: z.boolean().nullable(),
    takeaway: text(300).nullable(),
    city_id: cityId,
    status: z.enum(['approved', 'rejected']).describe('approved: processed and published; rejected: hidden everywhere'),
  })
  .partial();
export type CollectedUpdateInput = z.infer<typeof CollectedUpdateInput>;

/** Собранное событие для команды: любого статуса, с теми, кто нажал «Записаться». */
export interface AdminCollectedEventView extends AdminCollectedEvent {
  signups: { id: User['id']; first_name: string; username: string | null; at: Date }[];
}

// --- Организаторы собранных событий

/**
 * Профиль организатора — Host в Luma API (`id`, `name`). Остальное наше: его собирает сборщик по открытому Telegram.
 * `user_id` появляется, когда человек вошёл в сервис.
 */
/**
 * Модерация организатора, как у собранных событий. pending — ждёт решения, published — в каталоге, rejected — не показываем.
 * Организатор с опубликованными событиями виден в каталоге и в pending: его события команда уже одобрила;
 * Practice же показываются только у published. В Luma такого нет.
 */
export const HOST_STATUSES = ['pending', 'published', 'rejected'] as const;
export type HostStatus = (typeof HOST_STATUSES)[number];

export interface Host {
  id: string;
  user_id: User['id'] | null;
  telegram_id: number | null; // null — команда добавила по username, сборщик ещё не проверил его в Telegram
  username: string;
  name: string;
  city_id: string; // город: у найденного по событию — город события, иначе город по умолчанию
  bio: string | null;
  channel: string | null;
  summary: string | null;
  practices: Practice[]; // что ведёт без даты; найдено по его самопредставлению в чате
  status: HostStatus;
  offer_url: string | null; // сообщение в чате, из которого сборщик взял мастера: по нему модератор сверяет Practice
  photos_checked_at: Date | null;
  created_at: Date;
}

export interface AdminHostView extends Host {
  photos: { url: string; source_url: string }[]; // фото сообщества, новые сверху
}

/** Добавить организатора по username: профиль (имя, «о себе», канал, сводку) соберёт сборщик. В Luma такого нет. */
export const HostCreateInput = z.object({
  username: z.string().trim().regex(/^(?:https?:\/\/)?(?:t\.me\/|@)?\w{4,32}\/?$/, 'telegram username').describe('Telegram username, @username or t.me link of a person or a venue channel'),
  city_id: cityId.optional(),
});
export type HostCreateInput = z.infer<typeof HostCreateInput>;

export const HostUpdateInput = z
  .object({
    name: text(200).min(1),
    username,
    bio: text(1000).nullable(),
    channel: username.nullable().describe('Channel username, without @'),
    summary: text(2000).nullable(),
    city_id: cityId,
    status: z.enum(HOST_STATUSES).describe('Moderation: published — show in the public catalogue of organizers, rejected — never show'),
  })
  .partial();
export type HostUpdateInput = z.infer<typeof HostUpdateInput>;

// --- Города (в Luma такого нет)

export const CityCreateInput = City.pick({ id: true, name: true }).extend({ timezone: timeZone });
export type CityCreateInput = z.infer<typeof CityCreateInput>;

/** `id` не меняется: он стоит в `city_id` у источников, событий и организаторов. */
export const CityUpdateInput = CityCreateInput.omit({ id: true }).partial();
export type CityUpdateInput = z.infer<typeof CityUpdateInput>;

// --- Пользователи

export const UserUpdateInput = z
  .object({
    first_name: text(64).min(1),
    username: username.nullable(),
    lang: text(10).min(2),
    timezone: timeZone,
    features: z.array(Feature).transform((f) => [...new Set(f)]).describe('Features enabled for this person, the whole list: event_create lets them create events'),
  })
  .partial();
export type UserUpdateInput = z.infer<typeof UserUpdateInput>;

/** Пользователь, его события и ответы на чужие, собранные события, на которые он записался (их id для адреса). */
export interface AdminUserView {
  user: User;
  events: Event[];
  guests: (Guest & { event_name: string })[];
  collected_signups: string[];
}

/** Контакт организатора — как CalendarContact в Luma; `host_user_id` и `username` — наши. */
export interface AdminContact {
  id: string;
  host_user_id: User['id'];
  user_id: User['id'];
  first_name: string;
  username: string | null;
  created_at: Date;
}

export const AdminContactListInput = z.object({
  host_user_id: z.coerce.number().int().optional().describe('Only the audience of this host (Telegram id)'),
});
export type AdminContactListInput = z.infer<typeof AdminContactListInput>;

// --- Журнал действий команды (в Luma такого нет; ADR-0004)

/** Чего касается действие. `entity_id` — id в API: у собранного события — его адрес, у пользователя — Telegram id. */
export const ADMIN_ENTITIES = ['event', 'collected_event', 'host', 'user', 'account', 'conversation', 'message', 'contact', 'source', 'city'] as const;
export type AdminEntity = (typeof ADMIN_ENTITIES)[number];

/**
 * Строка журнала: кто из команды что сделал и с чем. `before` и `after` — снимки сущности до и после (null — её не было
 * или не стало); это данные для отмены, а не то, что видит пользователь. Секреты (код и пароль входа, токены)
 * в журнал не попадают.
 */
export interface AdminAction {
  id: string;
  created_at: Date;
  actor_id: User['id'];
  via: 'admin' | 'mcp'; // админка (REST) или агент через MCP — тогда actor_id владелец токена
  action: string; // имя инструмента MCP: admin_events_update
  entity: AdminEntity;
  entity_id: string;
  input: unknown;
  before: unknown;
  after: unknown;
  undoable: boolean;
  undo_of: string | null; // это действие отменяет то
  undone_by: string | null; // это действие отменено тем
}

/** Строка в списке журнала — без снимков: они бывают большими (обложка), их отдаёт `admin_actions_get`. */
export type AdminActionEntry = Omit<AdminAction, 'before' | 'after'>;

export const AdminActionListInput = z.object({
  entity: z.enum(ADMIN_ENTITIES).optional(),
  entity_id: z.string().max(200).optional(),
  actor_id: z.coerce.number().int().optional(),
  action: z.string().max(80).optional().describe('Tool name, e.g. admin_events_update'),
  pagination_cursor: z.uuid().optional().describe('next_cursor from the previous page'),
  pagination_limit: z.coerce.number().int().min(1).max(100).optional().describe('Default 50'),
});
export type AdminActionListInput = z.infer<typeof AdminActionListInput>;

/** Страница журнала, новые сверху — форма списков Luma. */
export interface AdminActionList {
  entries: AdminActionEntry[];
  has_more: boolean;
  next_cursor: string | null;
}
