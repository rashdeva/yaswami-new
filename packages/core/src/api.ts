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
  kind: true, title: true, place_text: true, place_url: true, capacity: true, allow_plus_one: true,
}).extend({ starts_at: dateTime, tz: timeZone });

export const EventCreateInput = eventFields
  .partial({ place_text: true, place_url: true, capacity: true, allow_plus_one: true })
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
  first_name: string;
  status: Guest['status'];
  ticket_type_id: string | null;
  plus_ones: number;
  is_me: boolean;
}

/** Событие целиком для одного зрителя. Скрытые типы билетов видит организатор и тот, кому тип назначен. */
export interface EventView {
  event: Event;
  ticket_types: TicketType[];
  guests: GuestView[]; // отказавшихся видит только организатор
  counts: { going: number; maybe: number };
  me: Guest | null;
  is_host: boolean;
}

export interface EventListItem {
  event: Event;
  is_host: boolean;
  my_status: Guest['status'] | null;
}
