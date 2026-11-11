// Операции над событиями. REST и MCP вызывают только эти функции — правила доступа и записи живут здесь.
import { randomBytes } from 'node:crypto';
import { and, asc, count, eq, exists, or, sql } from 'drizzle-orm';
import type {
  Event, EventCreateInput, EventListItem, EventUpdateInput, EventView, RsvpInput, TicketType,
  TicketTypeCreateInput, TicketTypeUpdateInput, User,
} from '@yaswami/core';
import { rsvp, ticketTypeRemovalError } from '@yaswami/core';
import type { Db, Tx } from './db/client.ts';
import { events, guests, ticketTypes, users } from './db/schema.ts';

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
  if (!event || (event.status === 'draft' && event.host_id !== actor.id)) throw new AppError('not_found', 404);
  return event;
}

async function findHostedEvent(tx: Tx, actor: User, id: string): Promise<Event> {
  const event = await findEvent(tx, actor, id, true);
  if (event.host_id !== actor.id) throw new AppError('forbidden', 403);
  return event;
}

const typesOf = (tx: Db | Tx, eventId: string) =>
  tx.select().from(ticketTypes).where(eq(ticketTypes.event_id, eventId)).orderBy(asc(ticketTypes.position), asc(ticketTypes.name));

export async function getEvent(db: Db | Tx, actor: User, id: string): Promise<EventView> {
  const event = await findEvent(db, actor, id);
  const types = await typesOf(db, id);
  const rows = await db
    .select({ guest: guests, first_name: users.first_name })
    .from(guests)
    .innerJoin(users, eq(users.id, guests.user_id))
    .where(eq(guests.event_id, id))
    .orderBy(asc(guests.responded_at));

  const is_host = event.host_id === actor.id;
  const me = rows.find((r) => r.guest.user_id === actor.id)?.guest ?? null;
  const going = rows.filter((r) => r.guest.status === 'going');
  return {
    event,
    ticket_types: types.filter((t) => is_host || !t.is_hidden || t.id === me?.ticket_type_id),
    guests: rows
      .filter((r) => is_host || r.guest.status !== 'declined')
      .map(({ guest: g, first_name }) => ({
        first_name, status: g.status, ticket_type_id: g.ticket_type_id, plus_ones: g.plus_ones, is_me: g.user_id === actor.id,
      })),
    counts: {
      going: going.reduce((n, r) => n + 1 + r.guest.plus_ones, 0),
      maybe: rows.filter((r) => r.guest.status === 'maybe').length,
    },
    me,
    is_host,
  };
}

/** События, которые пользователь ведёт или на которые ответил. */
export async function listEvents(db: Db, actor: User): Promise<EventListItem[]> {
  const mine = and(eq(guests.event_id, events.id), eq(guests.user_id, actor.id));
  const rows = await db
    .select({ event: events, my_status: guests.status })
    .from(events)
    .leftJoin(guests, mine)
    .where(or(eq(events.host_id, actor.id), exists(db.select().from(guests).where(mine))))
    .orderBy(asc(events.starts_at));
  return rows.map((r) => ({ event: r.event, is_host: r.event.host_id === actor.id, my_status: r.my_status }));
}

export async function createEvent(db: Db, actor: User, input: EventCreateInput): Promise<EventView> {
  return db.transaction(async (tx) => {
    const id = newEventId();
    await tx.insert(events).values({
      ...input, id, host_id: actor.id, starts_at: new Date(input.starts_at),
      place_text: input.place_text ?? '', status: input.status ?? 'published',
    });
    // У события всегда есть хотя бы один тип билета.
    await tx.insert(ticketTypes).values({ event_id: id, name: DEFAULT_TICKET_NAME });
    return getEvent(tx, actor, id);
  });
}

export async function updateEvent(db: Db, actor: User, id: string, input: EventUpdateInput): Promise<EventView> {
  return db.transaction(async (tx) => {
    await findHostedEvent(tx, actor, id);
    const { starts_at, ...rest } = input;
    await tx
      .update(events)
      .set({ ...rest, ...(starts_at ? { starts_at: new Date(starts_at) } : {}), rev: sql`${events.rev} + 1` })
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
      status: input.status,
      ticket_type_id: input.ticket_type_id,
      now: new Date(),
    });
    if (!result.ok) throw new AppError(result.error, result.error === 'ticket_unknown' ? 404 : 409);
    if (result.changed) {
      const { status, ticket_type_id, plus_ones, responded_at } = result.guest;
      await tx
        .insert(guests)
        .values(result.guest)
        .onConflictDoUpdate({ target: [guests.event_id, guests.user_id], set: { status, ticket_type_id, plus_ones, responded_at } });
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
    const [used] = await tx.select({ n: count() }).from(guests).where(eq(guests.ticket_type_id, id));
    if (used!.n > 0) throw new AppError('ticket_type_in_use', 409);
    await tx.delete(ticketTypes).where(eq(ticketTypes.id, id));
    await bumpRev(tx, type.event_id);
  });
}
