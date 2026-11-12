// Источник правды о данных: фронт и бэк импортируют схемы отсюда, таблицы БД сверяются с ними при компиляции.
// Имена полей — как в Luma API (name, start_at, timezone, max_capacity, approval_status…). Свои поля, которых
// в Luma нет: kind, status, allow_plus_one, widget_id, rev, price_text, position, plus_ones и ответ гостя «maybe».
// Необязательные значения — null, а не undefined: так же, как в строках БД.
import * as z from 'zod';

export const EVENT_KINDS = ['f', 'b', 'w', 'c', 's', 'o'] as const;
export const EVENT_STATUSES = ['draft', 'published', 'cancelled'] as const;
// Luma: approved | pending_approval | invited | declined | waitlist. «maybe» — наше: ответ «Думаю».
export const APPROVAL_STATUSES = ['approved', 'maybe', 'declined', 'waitlist'] as const;
export const SHARE_KINDS = ['widget', 'inline_message'] as const;

export const NAME_MAX = 60;
export const ADDRESS_MAX = 80;
// Живой анонс в каналах Дананга — 600–1500 знаков (agents/support/skills/my-events); 300 хватало только на «что взять».
export const DESCRIPTION_MAX = 2000;
export const TICKET_NAME_MAX = 30;
export const ABOUT_STEP_MAX = 200;
export const ABOUT_MAX = 300;
export const GUIDE_MAX = 1000;
export const TICKET_DESCRIPTION_MAX = 1000;

const count = z.number().int().nonnegative();
const httpUrl = z.url({ protocol: /^https?$/ }); // только http(s): ссылка попадает в интерфейс

export const User = z.object({
  id: z.number().int().positive(), // telegram id
  first_name: z.string().min(1),
  username: z.string().nullable(),
  lang: z.string(),
  timezone: z.string(),
});
export type User = z.infer<typeof User>;

/** Подмножество Address из Luma: пока только строка адреса. */
export const Address = z.object({ address: z.string().trim().min(1).max(ADDRESS_MAX) });
export type Address = z.infer<typeof Address>;

/** Гид по формату для конкретного события: на старте копия шаблона темы (TOPIC_GUIDES), дальше организатор правит под себя. */
export const Guide = z.object({
  what: z.string().trim().max(GUIDE_MAX),
  why: z.string().trim().max(GUIDE_MAX),
  first: z.string().trim().max(GUIDE_MAX),
  not_for: z.string().trim().max(GUIDE_MAX),
});
export type Guide = z.infer<typeof Guide>;

export const Event = z.object({
  id: z.string().min(1), // короткий slug
  user_id: User.shape.id, // организатор
  kind: z.enum(EVENT_KINDS),
  name: z.string().trim().min(1).max(NAME_MAX),
  description: z.string().trim().max(DESCRIPTION_MAX).nullable(), // что взять, как добраться, дресс-код
  start_at: z.date(),
  end_at: z.date().nullable(),
  timezone: z.string(),
  geo_address_json: Address.nullable(),
  meeting_url: httpUrl.nullable(),
  max_capacity: z.number().int().positive().nullable(), // общий лимит мест события
  allow_plus_one: z.boolean(),
  // «Что это мне даст»: свои у каждого события, правятся на экране «Редактировать → О событии».
  topic: z.string().trim().max(60).nullable(),
  what_happens: z.array(z.string().trim().min(1).max(ABOUT_STEP_MAX)).max(10), // шаги по порядку
  for_whom: z.string().trim().max(ABOUT_MAX).nullable(),
  beginner_friendly: z.boolean().nullable(), // null — не сказано
  takeaway: z.string().trim().max(ABOUT_MAX).nullable(), // обещание самого организатора
  guide: Guide.nullable(),
  status: z.enum(EVENT_STATUSES),
  widget_id: z.string().nullable(),
  rev: count,
  created_at: z.date(),
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
  approval_status: z.enum(APPROVAL_STATUSES),
  event_ticket_type_id: TicketType.shape.id.nullable(), // есть у approved и waitlist
  plus_ones: count,
  registered_at: z.date(),
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

// Ответ, который гость даёт сам: «Пойду» / «Думаю» / «Не пойду». В лист ожидания ставит система, не гость.
export const RsvpStatus = z.enum(['approved', 'maybe', 'declined']);
export type RsvpStatus = z.infer<typeof RsvpStatus>;

export const RsvpInput = z.object({
  approval_status: RsvpStatus,
  event_ticket_type_id: TicketType.shape.id.optional(),
});
export type RsvpInput = z.infer<typeof RsvpInput>;
