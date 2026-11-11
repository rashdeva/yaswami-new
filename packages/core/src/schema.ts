// Источник правды о данных: фронт и бэк импортируют схемы отсюда, таблицы БД сверяются с ними при компиляции.
// Имена полей TicketType — как в Luma API. Необязательные значения — null, а не undefined: так же, как в строках БД.
import * as z from 'zod';

export const EVENT_KINDS = ['f', 'b', 'w', 'c', 's', 'o'] as const;
export const EVENT_STATUSES = ['draft', 'published', 'cancelled'] as const;
export const GUEST_STATUSES = ['going', 'maybe', 'declined', 'waitlist'] as const;
export const SHARE_KINDS = ['widget', 'inline_message'] as const;

export const TITLE_MAX = 60;
export const PLACE_MAX = 80;
export const TICKET_NAME_MAX = 30;
export const TICKET_DESCRIPTION_MAX = 1000;

const count = z.number().int().nonnegative();

export const User = z.object({
  id: z.number().int().positive(), // telegram id
  first_name: z.string().min(1),
  username: z.string().nullable(),
  lang: z.string(),
  tz: z.string(),
});
export type User = z.infer<typeof User>;

export const Event = z.object({
  id: z.string().min(1), // короткий slug
  host_id: User.shape.id,
  kind: z.enum(EVENT_KINDS),
  title: z.string().min(1).max(TITLE_MAX),
  starts_at: z.date(),
  tz: z.string(),
  place_text: z.string().max(PLACE_MAX),
  place_url: z.url().nullable(),
  capacity: z.number().int().positive().nullable(), // общий лимит мест события
  allow_plus_one: z.boolean(),
  status: z.enum(EVENT_STATUSES),
  widget_id: z.string().nullable(),
  rev: count,
});
export type Event = z.infer<typeof Event>;

export const TicketType = z.object({
  id: z.string().min(1),
  event_id: Event.shape.id,
  name: z.string().min(1).max(TICKET_NAME_MAX),
  description: z.string().max(TICKET_DESCRIPTION_MAX).nullable(),
  max_capacity: z.number().int().positive().nullable(), // лимит мест этого типа
  is_hidden: z.boolean(),
  price_text: z.string().max(60).nullable(), // подпись, денег система не трогает
  position: count,
});
export type TicketType = z.infer<typeof TicketType>;

export const Guest = z.object({
  event_id: Event.shape.id,
  user_id: User.shape.id,
  status: z.enum(GUEST_STATUSES),
  ticket_type_id: TicketType.shape.id.nullable(), // есть у going и waitlist
  plus_ones: count,
  responded_at: z.date(),
});
export type Guest = z.infer<typeof Guest>;

export const Share = z.object({
  id: z.string().min(1),
  event_id: Event.shape.id,
  kind: z.enum(SHARE_KINDS),
  chat_id: z.number().int().nullable(),
  message_id: z.number().int().nullable(),
  inline_message_id: z.string().nullable(),
});
export type Share = z.infer<typeof Share>;

// Ответ, который гость даёт сам. В лист ожидания ставит система, не гость.
export const RsvpStatus = z.enum(['going', 'maybe', 'declined']);
export type RsvpStatus = z.infer<typeof RsvpStatus>;

export const RsvpInput = z.object({
  status: RsvpStatus,
  ticket_type_id: TicketType.shape.id.optional(),
});
export type RsvpInput = z.infer<typeof RsvpInput>;
