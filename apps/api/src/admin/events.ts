// События Ясвами глазами команды: любое событие, его гости, типы билетов и отзывы. Меняет команда от имени организатора
// события — через те же сервисы и с теми же правилами (лимиты мест, последний тип билета), что у него в приложении.
import { and, asc, desc, eq, gte, ilike, lt } from 'drizzle-orm';
import type {
  AdminEventCreateInput, AdminEventItem, AdminEventListInput, AdminEventView, AdminFeedback, AdminGuest, AdminGuestUpdateInput, EventUpdateInput, EventView,
  TicketType, TicketTypeCreateInput, TicketTypeUpdateInput, User,
} from '@yaswami/core';
import type { Ctx } from '../audit.ts';
import { audited } from '../audit.ts';
import type { Db } from '../db/client.ts';
import { eventFeedback, events, guests, ticketTypes, users } from '../db/schema.ts';
import { eventUrl } from '../notifications.ts';
import * as s from '../services.ts';
import { userById } from './users.ts';

/** Организатор события: от его имени команда смотрит и меняет любое событие. */
async function hostOf(db: Db, id: string): Promise<User> {
  const [row] = await db.select({ host: users }).from(events).innerJoin(users, eq(users.id, events.user_id)).where(eq(events.id, id));
  if (!row) throw new s.AppError('not_found', 404);
  return row.host;
}

/** События сервиса с именем организатора. Без отбора — все; `before` без `after` — новые сверху (прошедшие). */
export async function listAllEvents(db: Db, { after, before, query }: AdminEventListInput): Promise<AdminEventItem[]> {
  const rows = await db
    .select({ event: events, host_id: users.id, host_name: users.first_name, host_username: users.username })
    .from(events).innerJoin(users, eq(users.id, events.user_id))
    .where(and(
      after ? gte(events.start_at, new Date(after)) : undefined,
      before ? lt(events.start_at, new Date(before)) : undefined,
      query ? ilike(events.name, `%${query}%`) : undefined,
    ))
    .orderBy(before && !after ? desc(events.start_at) : asc(events.start_at))
    .limit(200); // ponytail: без страниц, пока событий меньше лимита
  return rows.map((r) => ({ ...r, url: eventUrl(r.event.id) }));
}

export const getAnyEvent = async (db: Db, id: string): Promise<AdminEventView> => ({ ...(await s.getEvent(db, await hostOf(db, id), id)), url: eventUrl(id) });

export const createAnyEvent = (db: Db, ctx: Ctx, { user_id, ...input }: AdminEventCreateInput): Promise<EventView> =>
  audited(db, ctx, { action: 'admin_events_create', entity: 'event', id: (v) => v.event.id, input: { user_id, ...input } }, async (tx) =>
    s.createEvent(tx, await userById(tx, user_id), input));

export const updateAnyEvent = (db: Db, ctx: Ctx, id: string, input: EventUpdateInput): Promise<EventView> =>
  audited(db, ctx, { action: 'admin_events_update', entity: 'event', id, input }, async (tx) => s.updateEvent(tx, await hostOf(tx, id), id, input));

/** Удалить событие совсем, с гостями и типами билетов (в Luma событие только отменяют — `status: cancelled`). */
export const deleteAnyEvent = (db: Db, ctx: Ctx, id: string): Promise<void> =>
  audited(db, ctx, { action: 'admin_events_delete', entity: 'event', id }, async (tx) => {
    await hostOf(tx, id);
    await tx.delete(events).where(eq(events.id, id));
  });

/** Гости события с их id — как `events/guests/list` в Luma. */
export async function listAnyGuests(db: Db, id: string): Promise<AdminGuest[]> {
  await hostOf(db, id);
  const rows = await db.select({ guest: guests, user_first_name: users.first_name, user_username: users.username })
    .from(guests).innerJoin(users, eq(users.id, guests.user_id)).where(eq(guests.event_id, id)).orderBy(asc(guests.registered_at));
  return rows.map((r) => ({ ...r.guest, user_first_name: r.user_first_name, user_username: r.user_username }));
}

/** Записать любого пользователя или изменить его ответ, билет и «+1» — от имени организатора. */
export const updateAnyGuest = (db: Db, ctx: Ctx, id: string, userId: number, input: AdminGuestUpdateInput): Promise<EventView> =>
  audited(db, ctx, { action: 'admin_events_guests_update', entity: 'event', id, input: { user_id: userId, ...input } }, async (tx) =>
    s.setGuest(tx, await hostOf(tx, id), await userById(tx, userId), id, input));

export const removeAnyGuest = (db: Db, ctx: Ctx, id: string, userId: number): Promise<void> =>
  audited(db, ctx, { action: 'admin_events_guests_remove', entity: 'event', id, input: { user_id: userId } }, async (tx) =>
    s.removeGuest(tx, await hostOf(tx, id), id, userId));

export const createAnyTicketType = (db: Db, ctx: Ctx, id: string, input: TicketTypeCreateInput): Promise<TicketType> =>
  audited(db, ctx, { action: 'admin_events_ticket_types_create', entity: 'event', id, input }, async (tx) =>
    s.createTicketType(tx, await hostOf(tx, id), id, input));

/** Событие типа билета: правка типа пишется в журнал как правка события — снимок события включает его типы. */
async function eventOfType(db: Db, id: string): Promise<string> {
  const [type] = await db.select({ event_id: ticketTypes.event_id }).from(ticketTypes).where(eq(ticketTypes.id, id));
  if (!type) throw new s.AppError('not_found', 404);
  return type.event_id;
}

export async function updateAnyTicketType(db: Db, ctx: Ctx, id: string, input: TicketTypeUpdateInput): Promise<TicketType> {
  const eventId = await eventOfType(db, id);
  return audited(db, ctx, { action: 'admin_events_ticket_types_update', entity: 'event', id: eventId, input: { event_ticket_type_id: id, ...input } }, async (tx) =>
    s.updateTicketType(tx, await hostOf(tx, eventId), id, input));
}

export async function deleteAnyTicketType(db: Db, ctx: Ctx, id: string): Promise<void> {
  const eventId = await eventOfType(db, id);
  return audited(db, ctx, { action: 'admin_events_ticket_types_delete', entity: 'event', id: eventId, input: { event_ticket_type_id: id } }, async (tx) =>
    s.deleteTicketType(tx, await hostOf(tx, eventId), id));
}

/** Отзывы гостей о событии, новые сверху. */
export async function listFeedback(db: Db, id: string): Promise<AdminFeedback[]> {
  await hostOf(db, id);
  const rows = await db.select({ f: eventFeedback, user_first_name: users.first_name, user_username: users.username })
    .from(eventFeedback).innerJoin(users, eq(users.id, eventFeedback.user_id)).where(eq(eventFeedback.event_id, id)).orderBy(desc(eventFeedback.updated_at));
  return rows.map(({ f, user_first_name, user_username }) => ({
    event_id: f.event_id, user_id: f.user_id, user_first_name, user_username, rating: f.rating, comment: f.comment, requested_at: f.requested_at, updated_at: f.updated_at,
  }));
}

export const deleteFeedback = (db: Db, ctx: Ctx, id: string, userId: number): Promise<void> =>
  audited(db, ctx, { action: 'admin_events_feedback_delete', entity: 'event', id, input: { user_id: userId } }, async (tx) => {
    const gone = await tx.delete(eventFeedback).where(and(eq(eventFeedback.event_id, id), eq(eventFeedback.user_id, userId))).returning({ user_id: eventFeedback.user_id });
    if (!gone.length) throw new s.AppError('not_found', 404);
  });
