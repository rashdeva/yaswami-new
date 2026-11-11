// Формы запросов и ответов. Одни и те же схемы проверяют REST-запросы, описывают инструменты MCP и формы на фронте.
import * as z from 'zod';
import type { Event, Guest, TicketType } from './schema.ts';
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
}

/** Карточка собранного события для витрины. */
export interface CollectedEventItem extends Omit<CollectedEvent, 'telegram_username' | 'whatsapp_phone' | 'url'> {
  id: string;
  signup_url: string; // куда ведёт «Записаться»: к организатору, а не в Ясвами
  source_url: string; // публикация, из которой взято событие
}

/** Тот же тип, каким он приходит по сети: даты в JSON — строки ISO. */
export type Wire<T> = T extends Date ? string : T extends object ? { [K in keyof T]: Wire<T[K]> } : T;
