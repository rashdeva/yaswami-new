// Операции команды над всем сервисом (`admin_*` в MCP, `/admin/*` в REST) и журнал этих действий: формы входа и ответа.
import * as z from 'zod';
import type { AdminCollectedEvent, EventView, Practice } from './api.ts';
import { cityId, dateTime, EventCreateInput, EventUpdateInput, PRACTICE_STATUSES, timeZone } from './api.ts';
import type { Event, Guest, User } from './schema.ts';
import { City, Feature, RsvpStatus, User as UserSchema } from './schema.ts';
import type { TopicItem } from './topics.ts';
import { DIRECTIONS, DIRECTION_SLUGS, OTHER_TOPIC, isTopic } from './topics.ts';

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
  user_id: UserSchema.shape.id.describe('User id of the host (admin_users_search), not a Telegram id'),
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
    instagram_username: z.string().trim().regex(/^@?[\w.]{1,30}$/, 'instagram handle').nullable().describe('Instagram handle for sign-up via direct messages, without @'),
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
 * Организатор виден в каталоге, пока не отклонён: его события и Practice команда одобряет по отдельности
 * (у Practice свой статус — PRACTICE_STATUSES); rejected прячет его целиком. В Luma такого нет.
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
  instagram_handle: string | null; // ник в Instagram без @; имя — как у Host в Luma
  summary: string | null;
  status: HostStatus;
  offer_url: string | null; // сообщение в чате, из которого сборщик взял мастера: по нему модератор сверяет Practice
  photos_checked_at: Date | null;
  profiled_at: Date | null; // когда сборщик последний раз смотрел профиль в Telegram
  created_at: Date;
}

/** Профиль организатора для команды: с его Practice любого статуса (что ведёт без даты; найдено по самопредставлению в чате). */
export interface AdminHost extends Host {
  practices: Practice[];
}

export interface AdminHostView extends AdminHost {
  photos: { url: string; source_url: string }[]; // фото сообщества, новые сверху
  practice_signups: { id: User['id']; first_name: string; username: string | null; practice_id: string; title: string; at: Date }[]; // кто нажал «Записаться» на Practice, новые сверху
}

/** Организатор в списке админки: профиль и сколько раз нажали «Записаться» на каждую его Practice (ключ — её id). */
export interface AdminHostListItem extends AdminHost {
  practice_signup_counts: Record<string, number>;
}

/** Practice, как её правит команда: то же, что извлекает сборщик. Тема — из наших Topic или «другое» (в каталоге не видна). */
export const PracticeInput = z.object({
  id: z.uuid().optional().describe('Id of an existing practice to keep or change; omit to add a new one'),
  title: text(200).min(1),
  topic: z.string().refine(isTopic, 'unknown topic').describe('Topic name from topics_list or «другое»; a practice with «другое» is hidden from the public catalogue'),
  description: text(500).nullable(),
  price: text(100).nullable().describe('Price as the organizer states it, e.g. «500k»; null — on request'),
  status: z.enum(PRACTICE_STATUSES).describe('Moderation: pending — waits for the team, published — shown in the public catalogue, rejected — never shown'),
});

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
    instagram_handle: z.string().trim().regex(/^@?[\w.]{1,30}$/, 'instagram handle').nullable().describe('Instagram handle, without @'),
    summary: text(2000).nullable(),
    city_id: cityId,
    status: z.enum(HOST_STATUSES).describe('rejected — hide the organizer with all events and practices; published — checked by the team. Each practice is moderated by its own status'),
    // Список целиком: чего в нём нет — удалено вместе с записями на неё. Practice с `id` правится на месте, без `id` — добавляется.
    practices: z.array(PracticeInput).max(30)
      .describe('Full list of practices and services the organizer runs; it replaces the stored one, so send every practice you want to keep, each with its `id`. An entry without `id` is added. To change one practice (e.g. approve it) use admin_practices_update instead'),
  })
  .partial();
export type HostUpdateInput = z.infer<typeof HostUpdateInput>;

/** Правка одной Practice: решение модератора (`status`) или её текст. Остальные Practice организатора не затрагивает. */
export const PracticeUpdateInput = PracticeInput.omit({ id: true }).partial();
export type PracticeUpdateInput = z.infer<typeof PracticeUpdateInput>;

// --- Города (в Luma такого нет)

export const CityCreateInput = City.pick({ id: true, name: true }).extend({
  timezone: timeZone, aliases: City.shape.aliases.optional(), latitude: City.shape.latitude.optional(), longitude: City.shape.longitude.optional(),
});
export type CityCreateInput = z.infer<typeof CityCreateInput>;

/** `id` не меняется: он стоит в `city_id` у источников, событий и организаторов. */
export const CityUpdateInput = CityCreateInput.omit({ id: true }).extend({ showcase_mode: City.shape.showcase_mode, launch_status: City.shape.launch_status }).partial();
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

/** Поставщики способов входа (CONTEXT.md). Telegram — один из них: users.id — не Telegram id (ADR-0008). В Luma такого нет. */
export const IDENTITY_PROVIDERS = ['telegram', 'apple', 'google'] as const;
export type IdentityProvider = (typeof IDENTITY_PROVIDERS)[number];

/** Пользователь для команды: `id` — наш, `telegram_id` — куда ему пишет бот (null — вошёл без Telegram), `identities` — как он входит. */
export interface AdminUser extends User {
  telegram_id: number | null;
  identities: IdentityProvider[];
}

/** Пользователь, его события и ответы на чужие, собранные события, на которые он записался (их id для адреса). */
export interface AdminUserView {
  user: AdminUser;
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
  host_user_id: z.coerce.number().int().optional().describe('Only the audience of this host (user id, not Telegram id)'),
});
export type AdminContactListInput = z.infer<typeof AdminContactListInput>;

// --- Журнал действий команды (в Luma такого нет; ADR-0004)

/** Чего касается действие. `entity_id` — id в API: у собранного события — его адрес, у пользователя — его id (не Telegram id). */
export const ADMIN_ENTITIES = ['event', 'collected_event', 'host', 'user', 'account', 'conversation', 'message', 'contact', 'source', 'calendar', 'city', 'topic', 'shelf', 'product'] as const;
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
  scope: z.string().max(40).optional().describe('Only actions made with an agent role token of this scope, e.g. librarian'),
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

// --- Темы (Topic). Список в базе; правят команда и хранитель тем (роль agents/librarian, ADR-0010). В Luma такого нет.

/** Сколько правок тем и раскладки событий хранитель может сделать за сутки: разбор не должен перетрясать каталог. */
export const LIBRARIAN_DAILY_CHANGES = 60;

/** Кто завёл тему: built_in — первые темы, team — команда или агент через MCP, collector — сборщик по накопившимся Tag. */
export const TOPIC_ORIGINS = ['built_in', 'team', 'collector'] as const;
export type TopicOrigin = (typeof TOPIC_ORIGINS)[number];

const guideText = (what: string) => text(400).min(1).describe(what);
export const TopicCreateInput = z.object({
  name: z.string().trim().toLowerCase().min(2).max(40).refine((n) => n !== OTHER_TOPIC, 'reserved')
    .describe('Topic name in Russian, lower case, as people say it: «баня», «настольные игры». It is the key stored on events and cannot be changed later'),
  slug: z.string().regex(/^[a-z][a-z0-9-]{1,23}$/).describe('Short latin name, e.g. «banya»: part of the icon address'),
  emoji: z.string().trim().min(1).max(8).describe('One emoji for places where the icon does not fit (bot messages)'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).describe('Topic colour #rrggbb, saturated, readable as text on white; differs from the colours of other topics'),
  what: guideText('Guide, 1–2 sentences: what happens at such an event'),
  why: guideText('Guide: what people come for. Tone «people come to…», never a promise of an effect'),
  first: guideText('Guide: how to get through the first visit — what to bring, what is normal'),
  not_for: guideText('Guide: who should be careful or check something beforehand'),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(30).default([])
    .describe('Tags that mean this topic (e.g. «цигун», «тайцзи»): events with topic «другое» and one of these tags move to the topic'),
  direction: z.enum(DIRECTION_SLUGS).nullable().optional()
    .describe(`Direction the topic belongs to — the big section people start from: ${DIRECTIONS.map((d) => `${d.slug} (${d.name})`).join(', ')}. Every topic should have one`),
  split_from: z.string().optional()
    .describe('Name of an existing broad topic this one is carved out of (`inside` of a candidate): its events carrying one of `tags` move to the new topic too, and people subscribed to the broad topic get subscribed to the new one'),
});
export type TopicCreateInput = z.infer<typeof TopicCreateInput>;

export const TopicUpdateInput = TopicCreateInput.omit({ name: true, slug: true, tags: true, split_from: true }).partial().extend({
  tags: TopicCreateInput.shape.tags.unwrap().optional(),
  enabled: z.boolean().optional().describe('false hides the topic: it leaves filters, subscriptions and the list the collector chooses from; events keep it and can be shown again'),
  icon_url: z.string().max(4_000_000).optional().describe('New icon: https link from the image generator or a data URL (png/jpeg). Square, one object on a plain white background'),
});
export type TopicUpdateInput = z.infer<typeof TopicUpdateInput>;

/** Тема в админке: с выключенными, метками и счётчиком. `has_icon` — иконка есть (в базе или файлом сборки). */
export interface AdminTopic extends TopicItem {
  tags: string[];
  enabled: boolean;
  origin: TopicOrigin;
  has_icon: boolean;
  events_count: number; // собранных событий с этой темой, любых статусов
  created_at: Date;
}

/** Порог для метки внутри существующей темы: столько событий у стольких разных организаторов. То же число — в store.mjs сборщика. */
export const TOPIC_SPLIT_MIN = { events: 10, hosts: 5 } as const;

export const TopicCandidateListInput = z.object({
  min_events: z.coerce.number().int().min(1).max(100).default(3).describe('Only tags met in at least this many events'),
});
export type TopicCandidateListInput = z.infer<typeof TopicCandidateListInput>;

/**
 * Кандидат в темы за последние 90 дней: Tag, который копится у событий без темы («другое») или стал заметным видом
 * занятий внутри широкой темы («мафия» внутри «игр»). Во втором случае порог выше — TOPIC_SPLIT_MIN.
 */
export interface TopicCandidate {
  tag: string;
  inside: string | null; // тема, в которой сейчас лежат события с меткой; null — без темы
  inside_events_count: number; // сколько всего событий в этой теме: метка на половину темы — это сама тема, а не её часть
  events_count: number;
  hosts_count: number; // сколько разных контактов для записи: один организатор с расписанием — ещё не тема
  examples: string[]; // названия событий — текст посторонних людей
}
