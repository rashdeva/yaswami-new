// Операции над событиями. REST и MCP вызывают только эти функции — правила доступа и записи живут здесь.
import { randomBytes } from 'node:crypto';
import { and, asc, count, eq, exists, gte, isNull, or, sql } from 'drizzle-orm';
import type {
  CollectedEventItem, Event, Me, EventCreateInput, EventListItem, EventUpdateInput, EventView, RsvpInput, TicketType,
  TicketTypeCreateInput, TicketTypeUpdateInput, User,
} from '@yaswami/core';
import { ADDRESS_MAX, collectedPath, collectedSignupUrl, DESCRIPTION_MAX, NAME_MAX, rsvp, ticketTypeRemovalError } from '@yaswami/core';
import type { Db, Tx } from './db/client.ts';
import { collectedEvents, collectedEventSignups, events, guests, ticketTypes, users } from './db/schema.ts';
import { settings } from './settings.ts';

export type ErrorStatus = 400 | 401 | 403 | 404 | 409;
export class AppError extends Error {
  code: string;
  status: ErrorStatus;
  constructor(code: string, status: ErrorStatus = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const DEFAULT_TICKET_NAME = 'Стандартный';
const newEventId = () => 'e_' + randomBytes(5).toString('hex');
const bumpRev = (tx: Tx, id: string) => tx.update(events).set({ rev: sql`${events.rev} + 1` }).where(eq(events.id, id));

/** Событие, если зрителю можно его видеть. Черновик виден только организатору. `lock` — блокировка строки до конца транзакции. */
async function findEvent(tx: Db | Tx, actor: User, id: string, lock = false): Promise<Event> {
  const q = tx.select().from(events).where(eq(events.id, id));
  const [event] = await (lock ? q.for('update') : q);
  if (!event || (event.status === 'draft' && event.user_id !== actor.id)) throw new AppError('not_found', 404);
  return event;
}

async function findHostedEvent(tx: Tx, actor: User, id: string): Promise<Event> {
  const event = await findEvent(tx, actor, id, true);
  if (event.user_id !== actor.id) throw new AppError('forbidden', 403);
  return event;
}

const typesOf = (tx: Db | Tx, eventId: string) =>
  tx.select().from(ticketTypes).where(eq(ticketTypes.event_id, eventId)).orderBy(asc(ticketTypes.position), asc(ticketTypes.name));

export async function getEvent(db: Db | Tx, actor: User, id: string): Promise<EventView> {
  const event = await findEvent(db, actor, id);
  const types = await typesOf(db, id);
  const rows = await db
    .select({ guest: guests, user_first_name: users.first_name })
    .from(guests)
    .innerJoin(users, eq(users.id, guests.user_id))
    .where(eq(guests.event_id, id))
    .orderBy(asc(guests.registered_at));

  const is_host = event.user_id === actor.id;
  const me = rows.find((r) => r.guest.user_id === actor.id)?.guest ?? null;
  const approved = rows.filter((r) => r.guest.approval_status === 'approved');
  return {
    event,
    ticket_types: types.filter((t) => is_host || !t.is_hidden || t.id === me?.event_ticket_type_id),
    guests: rows
      .filter((r) => is_host || r.guest.approval_status !== 'declined')
      .map(({ guest: g, user_first_name }) => ({
        user_first_name, approval_status: g.approval_status, event_ticket_type_id: g.event_ticket_type_id,
        plus_ones: g.plus_ones, is_me: g.user_id === actor.id,
      })),
    guest_counts: {
      approved: approved.reduce((n, r) => n + 1 + r.guest.plus_ones, 0),
      maybe: rows.filter((r) => r.guest.approval_status === 'maybe').length,
      declined: rows.filter((r) => r.guest.approval_status === 'declined').length,
    },
    me,
    is_host,
  };
}

/** События, которые пользователь ведёт или на которые ответил. */
export async function listEvents(db: Db, actor: User): Promise<EventListItem[]> {
  const mine = and(eq(guests.event_id, events.id), eq(guests.user_id, actor.id));
  const rows = await db
    .select({ event: events, my_approval_status: guests.approval_status })
    .from(events)
    .leftJoin(guests, mine)
    .where(or(eq(events.user_id, actor.id), exists(db.select().from(guests).where(mine))))
    .orderBy(asc(events.start_at));
  return rows.map((r) => ({ event: r.event, is_host: r.event.user_id === actor.id, my_approval_status: r.my_approval_status }));
}

// Идентификатор собранного события в адресах: telegram:<канал>/<публикация>#<номер> ↔ <канал>-<публикация>-<номер>.
export const collectedSlug = (externalId: string) => externalId.replace(/^telegram:/, '').replace(/\/(\d+)#(\d+)$/, '-$1-$2');
export function collectedExternalId(slug: string): string {
  const m = /^(.+)-(\d+)-(\d+)$/.exec(slug);
  if (!m) throw new AppError('not_found', 404);
  return `telegram:${m[1]}/${m[2]}#${m[3]}`;
}

const toCollectedItem = ({ external_id, event, announcement, claimed_event_id }: typeof collectedEvents.$inferSelect): CollectedEventItem => {
  const { telegram_username, whatsapp_phone, url, ...shown } = event;
  const id = collectedSlug(external_id);
  return {
    id, ...shown, claimed_event_id, source_url: announcement.url,
    signup_url: collectedSignupUrl(event, announcement.url, settings.publicUrl + collectedPath(id)),
  };
};
const upcomingCollected = gte(sql`coalesce(${collectedEvents.ends_at}, ${collectedEvents.starts_at})`, sql`now()`);

/** Предстоящие собранные события для витрины. Открыты всем: это пересказ публичных анонсов. */
export async function listCollectedEvents(db: Db): Promise<CollectedEventItem[]> {
  const rows = await db
    .select()
    .from(collectedEvents)
    .where(upcomingCollected)
    .orderBy(asc(collectedEvents.starts_at))
    .limit(500); // ponytail: без постраничной выдачи, пока событий одного города меньше лимита
  return rows.map(toCollectedItem);
}

/** Одно собранное событие. Прошедшее тоже отдаём: ссылка на него могла разойтись. */
export async function getCollectedEvent(db: Db, slug: string): Promise<CollectedEventItem> {
  const [row] = await db.select().from(collectedEvents).where(eq(collectedEvents.external_id, collectedExternalId(slug)));
  if (!row) throw new AppError('not_found', 404);
  return toCollectedItem(row);
}

/** Фиксирует, что человек собрался на событие. Повторный вызов ничего не меняет. */
export async function signUpForCollectedEvent(db: Db, actor: User, slug: string): Promise<CollectedEventItem> {
  const item = await getCollectedEvent(db, slug);
  await db.insert(collectedEventSignups).values({ external_id: collectedExternalId(slug), user_id: actor.id }).onConflictDoNothing();
  return item;
}

/**
 * Организатор подтверждает, что собранное событие — его: из него создаётся настоящее событие Ясвами с ним во главе.
 * Право подтверждает username в Telegram: он же указан в анонсе как контакт для записи.
 */
export async function claimCollectedEvent(db: Db, actor: User, slug: string): Promise<EventView> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(collectedEvents).where(eq(collectedEvents.external_id, collectedExternalId(slug))).for('update');
    if (!row) throw new AppError('not_found', 404);
    if (row.claimed_event_id) throw new AppError('already_claimed', 409);
    if (!actor.username || row.telegram_username !== actor.username.toLowerCase()) throw new AppError('forbidden', 403);

    const id = newEventId();
    const { title, description, place, address, price } = row.event;
    const where = [place, address].filter(Boolean).join(', ');
    // Лимит бесплатных событий здесь не проверяется: подтверждение — вход организатора в Ясвами, а не новое событие.
    await tx.insert(events).values({
      id, user_id: actor.id, kind: 'o', status: 'published', timezone: settings.timezone,
      name: title.trim().slice(0, NAME_MAX), description: description.trim().slice(0, DESCRIPTION_MAX) || null,
      start_at: row.starts_at, end_at: row.ends_at,
      geo_address_json: where ? { address: where.slice(0, ADDRESS_MAX) } : null,
    });
    await tx.insert(ticketTypes).values({ event_id: id, name: DEFAULT_TICKET_NAME, price_text: price?.slice(0, 60) ?? null });
    await tx.update(collectedEvents).set({ claimed_event_id: id }).where(eq(collectedEvents.external_id, row.external_id));
    return getEvent(tx, actor, id);
  });
}

export async function me(db: Db, actor: User): Promise<Me> {
  const signups = await db
    .select({ external_id: collectedEventSignups.external_id })
    .from(collectedEventSignups)
    .where(eq(collectedEventSignups.user_id, actor.id));
  const claimable = actor.username
    ? await db
        .select()
        .from(collectedEvents)
        .where(and(eq(collectedEvents.telegram_username, actor.username.toLowerCase()), isNull(collectedEvents.claimed_event_id), upcomingCollected))
        .orderBy(asc(collectedEvents.starts_at))
    : [];
  return {
    user: { id: actor.id, first_name: actor.first_name },
    collected_signups: signups.map((r) => collectedSlug(r.external_id)),
    claimable: claimable.map(toCollectedItem),
  };
}

export async function createEvent(db: Db, actor: User, input: EventCreateInput): Promise<EventView> {
  return db.transaction(async (tx) => {
    // Считаются все события организатора за всё время, включая подтверждённые из собранных.
    const [mine] = await tx.select({ n: count() }).from(events).where(eq(events.user_id, actor.id));
    if (mine!.n >= settings.freeEventsLimit) throw new AppError('events_limit', 403);
    const id = newEventId();
    await tx.insert(events).values({
      ...input, id, user_id: actor.id, start_at: new Date(input.start_at),
      end_at: input.end_at ? new Date(input.end_at) : null, status: input.status ?? 'published',
    });
    // У события всегда есть хотя бы один тип билета.
    await tx.insert(ticketTypes).values({ event_id: id, name: DEFAULT_TICKET_NAME });
    return getEvent(tx, actor, id);
  });
}

export async function updateEvent(db: Db, actor: User, id: string, input: EventUpdateInput): Promise<EventView> {
  return db.transaction(async (tx) => {
    await findHostedEvent(tx, actor, id);
    const { start_at, end_at, ...rest } = input;
    await tx
      .update(events)
      .set({
        ...rest,
        ...(start_at ? { start_at: new Date(start_at) } : {}),
        ...(end_at !== undefined ? { end_at: end_at ? new Date(end_at) : null } : {}),
        rev: sql`${events.rev} + 1`,
      })
      .where(eq(events.id, id));
    return getEvent(tx, actor, id);
  });
}

export async function rsvpEvent(db: Db, actor: User, id: string, input: RsvpInput): Promise<EventView> {
  return db.transaction(async (tx) => {
    // Блокировка строки события: два гостя не займут одно последнее место.
    const event = await findEvent(tx, actor, id, true);
    const result = rsvp({
      event,
      ticketTypes: await typesOf(tx, id),
      guests: await tx.select().from(guests).where(eq(guests.event_id, id)),
      user_id: actor.id,
      approval_status: input.approval_status,
      event_ticket_type_id: input.event_ticket_type_id,
      now: new Date(),
    });
    if (!result.ok) throw new AppError(result.error, result.error === 'ticket_unknown' ? 404 : 409);
    if (result.changed) {
      const { approval_status, event_ticket_type_id, plus_ones, registered_at } = result.guest;
      await tx
        .insert(guests)
        .values(result.guest)
        .onConflictDoUpdate({ target: [guests.event_id, guests.user_id], set: { approval_status, event_ticket_type_id, plus_ones, registered_at } });
      await bumpRev(tx, id);
    }
    return getEvent(tx, actor, id);
  });
}

export async function createTicketType(db: Db, actor: User, eventId: string, input: TicketTypeCreateInput): Promise<TicketType> {
  return db.transaction(async (tx) => {
    await findHostedEvent(tx, actor, eventId);
    const [created] = await tx.insert(ticketTypes).values({ ...input, event_id: eventId }).returning();
    await bumpRev(tx, eventId);
    return created!;
  });
}

/** Тип билета вместе с блокировкой его события; только для организатора. */
async function findHostedTicketType(tx: Tx, actor: User, id: string) {
  const [type] = await tx.select().from(ticketTypes).where(eq(ticketTypes.id, id));
  if (!type) throw new AppError('not_found', 404);
  await findHostedEvent(tx, actor, type.event_id);
  return { type, siblings: await typesOf(tx, type.event_id) };
}

const assertRemovable = (siblings: TicketType[], id: string) => {
  const error = ticketTypeRemovalError(siblings, id);
  if (error) throw new AppError(`ticket_type_${error}`, 409);
};

export async function updateTicketType(db: Db, actor: User, id: string, input: TicketTypeUpdateInput): Promise<TicketType> {
  return db.transaction(async (tx) => {
    const { type, siblings } = await findHostedTicketType(tx, actor, id);
    if (input.is_hidden && !type.is_hidden) assertRemovable(siblings, id);
    const [updated] = await tx.update(ticketTypes).set(input).where(eq(ticketTypes.id, id)).returning();
    await bumpRev(tx, type.event_id);
    return updated ?? type; // пустой input ничего не меняет
  });
}

export async function deleteTicketType(db: Db, actor: User, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const { type, siblings } = await findHostedTicketType(tx, actor, id);
    assertRemovable(siblings, id);
    const [used] = await tx.select({ n: count() }).from(guests).where(eq(guests.event_ticket_type_id, id));
    if (used!.n > 0) throw new AppError('ticket_type_in_use', 409);
    await tx.delete(ticketTypes).where(eq(ticketTypes.id, id));
    await bumpRev(tx, type.event_id);
  });
}
