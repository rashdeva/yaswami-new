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
}).extend({ start_at: dateTime, end_at: dateTime.nullable(), timezone: timeZone });

export const EventCreateInput = eventFields
  .partial({ description: true, end_at: true, geo_address_json: true, meeting_url: true, max_capacity: true, allow_plus_one: true })
  .extend({ status: z.enum(['draft', 'published']).optional() });
export type EventCreateInput = z.infer<typeof EventCreateInput>;

export const EventUpdateInput = eventFields.extend({ status: EventSchema.shape.status }).partial();
export type EventUpdateInput = z.infer<typeof EventUpdateInput>;

const ticketTypeFields = TicketTypeSchema.omit({ id: true, event_id: true });
export const TicketTypeCreateInput = ticketTypeFields.partial().required({ name: true });
export type TicketTypeCreateInput = z.infer<typeof TicketTypeCreateInput>;

export const TicketTypeUpdateInput = ticketTypeFields.partial();
export type TicketTypeUpdateInput = z.infer<typeof TicketTypeUpdateInput>;

export { RsvpInput };

/** Гость, как его видят другие: только имя, без username и id. */
export interface GuestView {
  user_first_name: string;
  approval_status: Guest['approval_status'];
  event_ticket_type_id: string | null;
  plus_ones: number;
  is_me: boolean;
}

/** Событие целиком для одного зрителя. Скрытые типы билетов видит организатор и тот, кому тип назначен. */
export interface EventView {
  event: Event;
  ticket_types: TicketType[];
  guests: GuestView[]; // отказавшихся видит только организатор
  guest_counts: { approved: number; maybe: number; declined: number }; // approved — занятые места, с учётом «+1»
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
  confirmed: boolean; // человек вошёл в Ясвами; иначе профиль собран без его участия
}

/** Карточка собранного события для витрины. */
export interface CollectedEventItem extends Omit<CollectedEvent, 'telegram_username' | 'whatsapp_phone' | 'url'> {
  id: string; // годится для адреса страницы: <канал>-<публикация>-<номер события в ней>
  signup_url: string; // куда ведёт «Записаться»: к организатору, а не в Ясвами
  source_url: string; // публикация, из которой взято событие
  claimed_event_id: Event['id'] | null; // организатор подтвердил событие: запись идёт через событие Ясвами
  hosts?: CollectedHost[]; // как hosts у события в Luma; только в ответе на одно событие, в списках его нет
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
