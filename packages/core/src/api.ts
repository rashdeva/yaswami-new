// Формы запросов и ответов. Одни и те же схемы проверяют REST-запросы, описывают инструменты MCP и формы на фронте.
import * as z from 'zod';
import type { Event, Guest, TicketType, User } from './schema.ts';
import { Event as EventSchema, RsvpInput, TicketType as TicketTypeSchema } from './schema.ts';

const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
// В JSON дата — строка ISO с часовым поясом; в Date её превращает бэк.
const dateTime = z.iso.datetime({ offset: true }).describe('ISO 8601 with offset, e.g. 2026-11-20T19:00:00+04:00');
const timeZone = z.string().refine(isTimeZone, 'unknown time zone').describe('IANA time zone, e.g. Asia/Tbilisi');

const eventFields = EventSchema.pick({
  kind: true, name: true, description: true, geo_address_json: true, meeting_url: true, max_capacity: true, allow_plus_one: true,
  topic: true, what_happens: true, for_whom: true, beginner_friendly: true, takeaway: true, guide: true,
}).extend({ start_at: dateTime, end_at: dateTime.nullable(), timezone: timeZone });

const ticketTypeFields = TicketTypeSchema.omit({ id: true, event_id: true });

export const EventCreateInput = eventFields
  .partial({
    description: true, end_at: true, geo_address_json: true, meeting_url: true, max_capacity: true, allow_plus_one: true,
    topic: true, what_happens: true, for_whom: true, beginner_friendly: true, takeaway: true, guide: true,
  })
  .extend({
    status: z.enum(['draft', 'published']).optional(),
    // Типы билетов сразу при создании (порядок = position). Без них — один «Стандартный» без цены.
    ticket_types: z.array(ticketTypeFields.partial()).max(10).optional(),
  });
export type EventCreateInput = z.infer<typeof EventCreateInput>;

export const EventUpdateInput = eventFields.extend({ status: EventSchema.shape.status }).partial();
export type EventUpdateInput = z.infer<typeof EventUpdateInput>;

export const TicketTypeCreateInput = ticketTypeFields.partial().required({ name: true });
export type TicketTypeCreateInput = z.infer<typeof TicketTypeCreateInput>;

export const TicketTypeUpdateInput = ticketTypeFields.partial();
export type TicketTypeUpdateInput = z.infer<typeof TicketTypeUpdateInput>;

export { RsvpInput };

/** Заход на событие. `ref` — id пользователя, по чьей ссылке пришли (хвост `-r<id>` в startapp). */
export const VisitInput = z.object({ ref: z.number().int().positive().optional() });
export type VisitInput = z.infer<typeof VisitInput>;

/** Поиск человека среди пользователей сервиса. */
export const UserSearchInput = z.object({ query: z.string().trim().min(1).max(64).describe('Part of a first name or @username') });
export type UserSearchInput = z.infer<typeof UserSearchInput>;

/** Решение иллюстратора об обложке собранного события. */
export const CoverSetInput = z.object({
  image_url: z.url().optional().describe('Public URL of a generated 9:16 image (files-cdn.x.ai). Omit to keep the announcement photo as the cover.'),
});
export type CoverSetInput = z.infer<typeof CoverSetInput>;

/** Гость, как его видят другие: только имя и фото, без username и id. */
export interface GuestView {
  user_first_name: string;
  user_photo_url: string | null; // аватар из Telegram, сохранённый у нас; null — фото нет
  approval_status: Guest['approval_status'];
  event_ticket_type_id: string | null;
  plus_ones: number;
  is_me: boolean;
}

/** Событие целиком для одного зрителя. Скрытые типы билетов видит организатор и тот, кому тип назначен. */
export interface EventView {
  event: Event;
  ticket_types: TicketType[];
  host: { first_name: string; user_photo_url: string | null };
  guests: GuestView[]; // отказавшихся видит только организатор
  guest_counts: { approved: number; maybe: number; declined: number }; // approved — занятые места, с учётом «+1»
  /** Отзывы гостей после события: средняя оценка видна всем, сами отзывы — только организатору. */
  feedback: { count: number; average: number | null; items: { user_first_name: string; rating: number; comment: string | null }[] };
  me: Guest | null;
  is_host: boolean;
}

export interface EventListItem {
  event: Event;
  is_host: boolean;
  my_approval_status: Guest['approval_status'] | null;
}

/** Событие, собранное из Telegram-канала (apps/collector): хозяина в Ясвами у него ещё нет, данные извлечены ИИ. */
export interface CollectedEvent {
  title: string;
  description: string;
  starts_at: string; // ISO 8601 с offset часового пояса города
  ends_at: string | null;
  place: string | null;
  address: string | null;
  price: string | null;
  tags: string[];
  telegram_username: string | null;
  whatsapp_phone: string | null;
  url: string | null;
  // Ниже — «что это мне даст»: поля появились позже остальных, у ранее собранных событий их нет.
  topic?: string; // ключ TOPIC_GUIDES или OTHER_TOPIC
  what_happens?: string[]; // что человек будет делать, по порядку публикации
  for_whom?: string | null;
  beginner_friendly?: boolean | null; // null — в анонсе не сказано
  takeaway?: string | null; // только обещание самого организатора
}

/**
 * Организатор собранного события: профиль составлен автоматически по его Telegram и каналу. Имена — как у Host
 * в Luma API (`hosts`, `name`); `summary`, `channel_url` и `confirmed` — наши: у человека в Luma нет ни описания, ни ссылок.
 */
export interface CollectedHost {
  name: string;
  summary: string | null; // сводка ИИ по каналу и «о себе»
  channel_url: string | null;
  photo_url: string; // аватарка прямо с серверов Telegram, у себя не храним; если фото нет или оно скрыто — по адресу 404
  confirmed: boolean; // человек вошёл в Ясвами; иначе профиль собран без его участия
  /** Фото сообщества: последние картинки из канала, сохранённые у нас; новые сверху. `source_url` — публикация, из которой взято фото. */
  photos: { url: string; source_url: string }[];
}

/** Карточка собранного события для витрины. */
export interface CollectedEventItem extends Omit<CollectedEvent, 'telegram_username' | 'whatsapp_phone' | 'url'> {
  id: string; // годится для адреса страницы: <канал>-<публикация>-<номер события в ней>
  signup_url: string; // куда ведёт «Записаться»: к организатору, а не в Ясвами
  source_url: string; // публикация, из которой взято событие
  claimed_event_id: Event['id'] | null; // организатор подтвердил событие: запись идёт через событие Ясвами
  hosts?: CollectedHost[]; // как hosts у события в Luma; только в ответе на одно событие, в списках его нет
  signups_count?: number; // сколько человек нажали «Записаться» в Ясвами (это интерес, не подтверждённое место); только в ответе на одно событие
  cover_url?: string | null; // обложка 9:16: фото анонса или нарисованная; нет — показываем иконку темы
  video_url?: string | null; // ролик-история 9:16 о событии; название и время накладывает страница, в самом ролике текста нет
  views?: number | null; // просмотры публикации-источника; у публикаций в группах их нет
  reactions?: number | null; // сколько реакций под публикацией-источником
  popular?: boolean; // отклик заметно выше обычного для этого источника (popularIds)
}

/** Путь собранного события от разбора анонса до ленты; в ленте — только published. */
export const COLLECTED_STATUSES = ['pending', 'approved', 'published', 'rejected'] as const;
export type CollectedStatus = (typeof COLLECTED_STATUSES)[number];

/** Собранное событие в админке модерации: любого статуса, с источником. */
export interface AdminCollectedEvent extends CollectedEventItem {
  status: CollectedStatus;
  channel: string; // источник: канал или группа, откуда анонс
}

/** Отбор собранных событий в модерации: без статуса — все. */
export const CollectedListInput = z.object({ status: z.enum(COLLECTED_STATUSES).optional().describe('Only this status; pending — waiting for a decision') });
export type CollectedListInput = z.infer<typeof CollectedListInput>;

/** Решение модератора: одобрить (дальше обработка и публикация) или отклонить (снять с публикации). */
export const CollectedModerateInput = z.object({ status: z.enum(['approved', 'rejected']) });
export type CollectedModerateInput = z.infer<typeof CollectedModerateInput>;

/** Собранное событие в «Моих событиях»: куда человек заходил или нажимал «Записаться». */
export interface MyCollectedItem {
  event: CollectedEventItem;
  signed_up: boolean; // иначе только заходил
}

/**
 * Человек из аудитории организатора — как CalendarContact в Luma API (`GET /v1/calendars/contacts/list`): те же имена
 * полей, где они у нас есть. `username` — наше: вместо email у нас Telegram. Попадает в контакты, зайдя на событие
 * организатора или ответив на него.
 */
export interface Contact {
  id: string;
  user_id: User['id'];
  created_at: Date;
  event_approved_count: number; // на сколько событий организатора человек идёт
  first_name: string;
  username: string | null;
}

/** Кто вошёл и на какие собранные события он уже записывался. */
export interface Me {
  user: Pick<User, 'id' | 'first_name'>;
  collected_signups: CollectedEventItem['id'][];
  /** Предстоящие собранные события, где контактом указан этот человек: их можно подтвердить как свои. */
  claimable: CollectedEventItem[];
}

/** Открытые настройки для фронта: из чего собрать ссылку на событие t.me/<бот>/<приложение>?startapp=<id>. */
export interface AppConfig {
  bot_username: string | null;
  app_name: string;
  web_login: boolean; // на сайте можно войти через Telegram (настроен Client Secret)
  city: string; // город витрины; пока он один
  free_events_limit: number; // сколько событий создаётся бесплатно
}

/** Тот же тип, каким он приходит по сети: даты в JSON — строки ISO. */
export type Wire<T> = T extends Date ? string : T extends object ? { [K in keyof T]: Wire<T[K]> } : T;
