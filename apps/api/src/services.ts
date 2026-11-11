// Операции над событиями. REST и MCP вызывают только эти функции — правила доступа и записи живут здесь.
import { randomBytes } from 'node:crypto';
import { and, asc, count, desc, eq, exists, getTableColumns, gte, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type {
  CollectedEventItem, Contact, MyCollectedItem, Event, Me, EventCreateInput, EventListItem, EventUpdateInput, EventView, RsvpInput, TicketType,
  TicketTypeCreateInput, TicketTypeUpdateInput, User, VisitInput,
} from '@yaswami/core';
import type { CollectedEvent } from '@yaswami/core';
import { isSameEvent, mergeEvents } from '@yaswami/extract';
import { ADDRESS_MAX, collectedPath, collectedSignupUrl, popularIds, DESCRIPTION_MAX, NAME_MAX, rsvp, ticketTypeRemovalError, TOPIC_GUIDES } from '@yaswami/core';
import type { Db, Tx } from './db/client.ts';
import { collectedEvents, collectedEventSignups, contacts, events, guests, hosts, photos, ticketTypes, users, visits } from './db/schema.ts';
import { photoUrl } from './photos.ts';
import { eventFeedbackView } from './feedback.ts';
import { guestRegistered } from './rsvp-notices.ts';
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
const HOST_PHOTOS = 6; // сколько фото сообщества показываем у организатора; столько же хранит сборщик
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
    .select({ guest: guests, user_first_name: users.first_name, photo_id: photos.id })
    .from(guests)
    .innerJoin(users, eq(users.id, guests.user_id))
    .leftJoin(photos, eq(photos.user_id, guests.user_id))
    .where(eq(guests.event_id, id))
    .orderBy(asc(guests.registered_at));

  const [hostRow] = await db
    .select({ first_name: users.first_name, photo_id: photos.id })
    .from(users)
    .leftJoin(photos, eq(photos.user_id, users.id))
    .where(eq(users.id, event.user_id));
  const is_host = event.user_id === actor.id;
  const me = rows.find((r) => r.guest.user_id === actor.id)?.guest ?? null;
  const approved = rows.filter((r) => r.guest.approval_status === 'approved');
  return {
    event,
    ticket_types: types.filter((t) => is_host || !t.is_hidden || t.id === me?.event_ticket_type_id),
    host: { first_name: hostRow!.first_name, user_photo_url: hostRow!.photo_id && photoUrl(hostRow!.photo_id) },
    guests: rows
      .filter((r) => is_host || r.guest.approval_status !== 'declined')
      .map(({ guest: g, user_first_name, photo_id }) => ({
        user_first_name, user_photo_url: photo_id && photoUrl(photo_id), approval_status: g.approval_status, event_ticket_type_id: g.event_ticket_type_id,
        plus_ones: g.plus_ones, is_me: g.user_id === actor.id,
      })),
    guest_counts: {
      approved: approved.reduce((n, r) => n + 1 + r.guest.plus_ones, 0),
      maybe: rows.filter((r) => r.guest.approval_status === 'maybe').length,
      declined: rows.filter((r) => r.guest.approval_status === 'declined').length,
    },
    feedback: await eventFeedbackView(db as Db, id, is_host),
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

type CollectedRow = typeof collectedEvents.$inferSelect & { cover_id?: string | null };
const toCollectedItem = ({ external_id, event, announcement, claimed_event_id, views, reactions, cover_id }: CollectedRow): CollectedEventItem => {
  const { telegram_username, whatsapp_phone, url, ...shown } = event;
  const id = collectedSlug(external_id);
  return {
    id, ...shown, claimed_event_id, views, reactions, cover_url: cover_id ? photoUrl(cover_id) : null, source_url: announcement.url,
    signup_url: collectedSignupUrl(event, announcement.url, settings.publicUrl + collectedPath(id)),
  };
};
const upcomingCollected = gte(sql`coalesce(${collectedEvents.ends_at}, ${collectedEvents.starts_at})`, sql`now()`);
/** Собранные события вместе с id обложки. */
const collectedWithCover = (db: Db) => db
  .select({ ...getTableColumns(collectedEvents), cover_id: photos.id })
  .from(collectedEvents)
  .leftJoin(photos, eq(photos.collected_external_id, collectedEvents.external_id));

/** Предстоящие собранные события для витрины. Открыты всем: это пересказ публичных анонсов. */
export async function listCollectedEvents(db: Db): Promise<CollectedEventItem[]> {
  const rows = await collectedWithCover(db)
    .where(upcomingCollected)
    .orderBy(asc(collectedEvents.starts_at))
    .limit(500); // ponytail: без постраничной выдачи, пока событий одного города меньше лимита
  const popular = popularIds(rows, (r) => r.external_id);
  return rows.map((r) => ({ ...toCollectedItem(r), popular: popular.has(r.external_id) }));
}

/** Предстоящие события, обложку которых иллюстратор ещё не смотрел. `photo_url` — фото анонса, если сборщик его сохранил. */
export async function listPendingCovers(db: Db) {
  const rows = await collectedWithCover(db).where(and(upcomingCollected, isNull(collectedEvents.cover_checked_at))).orderBy(asc(collectedEvents.starts_at)).limit(20);
  return rows.map(({ external_id, event: { title, description, topic, tags, place }, cover_id }) => ({
    id: collectedSlug(external_id), title, description, topic: topic ?? null, tags, place, photo_url: cover_id ? photoUrl(cover_id) : null,
  }));
}

// Откуда иллюстратор может принести картинку: хранилище xAI, куда Grok кладёт нарисованное. Свободный адрес
// не берём — иначе через инструмент можно заставить сервер сходить куда угодно.
const COVER_HOSTS = new Set(['files-cdn.x.ai', 'imgen.x.ai']);
const COVER_MAX_BYTES = 2_000_000; // нарисованная обложка 720×1280 весит 100–400 КБ

/**
 * Иллюстратор посмотрел обложку события. С `image_url` — заменить её нарисованной (скачиваем и храним у себя,
 * ADR-0003); без него — оставить как есть (фото анонса годится).
 */
export async function setCollectedCover(db: Db, slug: string, imageUrl?: string): Promise<{ cover_url: string | null }> {
  const external_id = collectedExternalId(slug);
  let data: Buffer | null = null;
  if (imageUrl) {
    const url = URL.parse(imageUrl);
    if (url?.protocol !== 'https:' || !COVER_HOSTS.has(url.hostname)) throw new AppError('bad_image_url', 400);
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: 'error' }).catch(() => null);
    data = res?.ok ? Buffer.from(await res.arrayBuffer()) : null;
    const isImage = data && (data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) || (data[0] === 0xff && data[1] === 0xd8));
    if (!data || !isImage || data.length > COVER_MAX_BYTES) throw new AppError('bad_image', 400);
  }
  return db.transaction(async (tx) => {
    const [row] = await tx.update(collectedEvents).set({ cover_checked_at: new Date() }).where(eq(collectedEvents.external_id, external_id)).returning({ id: collectedEvents.external_id });
    if (!row) throw new AppError('not_found', 404);
    if (data) {
      await tx.delete(photos).where(eq(photos.collected_external_id, external_id));
      await tx.insert(photos).values({ collected_external_id: external_id, source: imageUrl!, data });
    }
    const [cover] = await tx.select({ id: photos.id }).from(photos).where(eq(photos.collected_external_id, external_id));
    return { cover_url: cover ? photoUrl(cover.id) : null };
  });
}

/** Одно собранное событие. Прошедшее тоже отдаём: ссылка на него могла разойтись. */
export async function getCollectedEvent(db: Db, slug: string): Promise<CollectedEventItem> {
  const [row] = await collectedWithCover(db).where(eq(collectedEvents.external_id, collectedExternalId(slug)));
  if (!row) throw new AppError('not_found', 404);
  const [h] = row.telegram_username ? await db.select().from(hosts).where(eq(hosts.username, row.telegram_username)) : [];
  const shots = h
    ? await db.select({ id: photos.id, source: photos.source }).from(photos).where(eq(photos.host_id, h.id)).orderBy(desc(photos.created_at)).limit(HOST_PHOTOS)
    : [];
  const [{ n: signups_count }] = await db.select({ n: count() }).from(collectedEventSignups).where(eq(collectedEventSignups.external_id, row.external_id)) as [{ n: number }];
  // «Популярное» — относительно остальных предстоящих событий источника, поэтому смотрим на них все.
  const upcoming = await db
    .select({ external_id: collectedEvents.external_id, channel: collectedEvents.channel, views: collectedEvents.views, reactions: collectedEvents.reactions })
    .from(collectedEvents).where(upcomingCollected);
  return {
    ...toCollectedItem(row),
    popular: popularIds(upcoming, (r) => r.external_id).has(row.external_id),
    signups_count,
    hosts: h
      ? [{ name: h.name, summary: h.summary, channel_url: h.channel && `https://t.me/${h.channel}`,
          photo_url: `https://t.me/i/userpic/320/${h.username}.jpg`, confirmed: h.user_id !== null,
          // Источник фото сообщества — telegram:<канал>/<публикация>: из него же ссылка на публикацию.
          photos: shots.map((p) => ({ url: photoUrl(p.id), source_url: p.source.replace(/^telegram:/, 'https://t.me/') })) }]
      : [],
  };
}

/** Фиксирует, что человек собрался на событие. Повторный вызов ничего не меняет. */
export async function signUpForCollectedEvent(db: Db, actor: User, slug: string): Promise<CollectedEventItem> {
  const item = await getCollectedEvent(db, slug);
  await db.insert(collectedEventSignups).values({ external_id: collectedExternalId(slug), user_id: actor.id }).onConflictDoNothing();
  return item;
}

/** Событие Ясвами из того, что извлёк ИИ: организатор — `actor`, один тип билета с ценой из анонса. */
async function insertExtractedEvent(tx: Tx, actor: User, extracted: CollectedEvent): Promise<string> {
  const id = newEventId();
  const { title, description, place, address, price, topic } = extracted;
  const template = topic ? TOPIC_GUIDES[topic] : undefined;
  const where = [place, address].filter(Boolean).join(', ');
  await tx.insert(events).values({
    id, user_id: actor.id, kind: 'o', status: 'published', timezone: settings.timezone,
    name: title.trim().slice(0, NAME_MAX), description: description.trim().slice(0, DESCRIPTION_MAX) || null,
    start_at: new Date(extracted.starts_at), end_at: extracted.ends_at ? new Date(extracted.ends_at) : null,
    geo_address_json: where ? { address: where.slice(0, ADDRESS_MAX) } : null,
    topic: template ? topic : null, what_happens: extracted.what_happens ?? [], for_whom: extracted.for_whom ?? null,
    beginner_friendly: extracted.beginner_friendly ?? null, takeaway: extracted.takeaway ?? null,
    guide: template ? { what: template.what, why: template.why, first: template.first, not_for: template.not_for } : null,
  });
  await tx.insert(ticketTypes).values({ event_id: id, name: DEFAULT_TICKET_NAME, price_text: price?.slice(0, 60) ?? null });
  return id;
}

// Считаются все события организатора за всё время, включая подтверждённые из собранных.
async function assertUnderLimit(tx: Tx, actor: User) {
  const [mine] = await tx.select({ n: count() }).from(events).where(eq(events.user_id, actor.id));
  if (mine!.n >= settings.freeEventsLimit) throw new AppError('events_limit', 403);
}

/**
 * Чужой анонс, пересланный боту, попадает на витрину как собранное событие — так же, как из каналов сборщика.
 * Повтор уже известного события (isSameEvent) дополняет его запись, а не создаёт вторую.
 */
export async function addCollectedEvent(
  db: Db, source: { channel: string; number: number; url: string }, index: number, extracted: CollectedEvent,
): Promise<CollectedEventItem> {
  return db.transaction(async (tx) => {
    const known = await tx.select().from(collectedEvents).where(upcomingCollected).for('update');
    const same = known.find((r) => isSameEvent(r.event, extracted));
    const event = same ? mergeEvents(same.event, extracted) : extracted;
    const values = {
      event, starts_at: new Date(event.starts_at), ends_at: event.ends_at ? new Date(event.ends_at) : null,
      telegram_username: event.telegram_username?.replace(/^@/, '').toLowerCase() ?? null, updated_at: new Date(),
    };
    const [row] = await tx
      .insert(collectedEvents)
      .values({
        ...values, channel: source.channel, announcement: { url: source.url }, signup_url: source.url,
        external_id: same?.external_id ?? `telegram:${source.channel}/${source.number}#${index}`,
      })
      .onConflictDoUpdate({ target: collectedEvents.external_id, set: values })
      .returning();
    return toCollectedItem(row!);
  });
}

/**
 * Событие из анонса, который человек прислал боту: он считается организатором. Если то же событие уже собрано
 * из каналов и контактом в нём указан он же — оно подтверждается за ним (правило то же, что в claimCollectedEvent).
 */
export async function createEventFromAnnouncement(db: Db, actor: User, extracted: CollectedEvent): Promise<EventView> {
  return db.transaction(async (tx) => {
    await assertUnderLimit(tx, actor);
    const id = await insertExtractedEvent(tx, actor, extracted);
    if (actor.username) {
      const rows = await tx
        .select()
        .from(collectedEvents)
        .where(and(eq(collectedEvents.telegram_username, actor.username.toLowerCase()), isNull(collectedEvents.claimed_event_id), upcomingCollected))
        .for('update');
      const same = rows.find((r) => isSameEvent(r.event, extracted));
      if (same) await tx.update(collectedEvents).set({ claimed_event_id: id }).where(eq(collectedEvents.external_id, same.external_id));
    }
    return getEvent(tx, actor, id);
  });
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

    // Лимит бесплатных событий здесь не проверяется: подтверждение — вход организатора в Ясвами, а не новое событие.
    const id = await insertExtractedEvent(tx, actor, row.event);
    await tx.update(collectedEvents).set({ claimed_event_id: id }).where(eq(collectedEvents.external_id, row.external_id));
    return getEvent(tx, actor, id);
  });
}

/** Кто позвал: существующий пользователь, не сам зритель. Подделанный или свой `ref` молча отбрасываем. */
async function referrerOf(db: Db, actor: User, ref: number | undefined): Promise<number | null> {
  if (!ref || ref === actor.id) return null;
  const [found] = await db.select({ id: users.id }).from(users).where(eq(users.id, ref));
  return found?.id ?? null;
}

/** Человек попадает в контакты организатора. Повтор ничего не меняет; сам себе организатор не контакт. */
const addContact = (tx: Db | Tx, hostUserId: number, userId: number) =>
  hostUserId === userId ? null : tx.insert(contacts).values({ host_user_id: hostUserId, user_id: userId }).onConflictDoNothing();

/** Контакты организатора, новые сверху — форма как у `GET /v1/calendars/contacts/list` в Luma API. */
export async function listContacts(db: Db, actor: User): Promise<{ entries: Contact[] }> {
  const entries = await db
    .select({
      id: contacts.id, user_id: contacts.user_id, created_at: contacts.created_at,
      first_name: users.first_name, username: users.username,
      event_approved_count: sql<number>`(select count(*)::int from ${guests} join ${events} on ${events.id} = ${guests.event_id}
        where ${guests.user_id} = ${contacts.user_id} and ${events.user_id} = ${contacts.host_user_id} and ${guests.approval_status} = 'approved')`,
    })
    .from(contacts)
    .innerJoin(users, eq(users.id, contacts.user_id))
    .where(eq(contacts.host_user_id, actor.id))
    .orderBy(desc(contacts.created_at))
    .limit(1000); // ponytail: без постраничной выдачи (у Luma — pagination_cursor), пока контактов меньше лимита
  return { entries };
}

/** Фиксирует заход на событие Ясвами. Собственные заходы организатора не считаются. */
export async function visitEvent(db: Db, actor: User, id: string, { ref }: VisitInput): Promise<void> {
  const event = await findEvent(db, actor, id);
  if (event.user_id === actor.id) return;
  await db.insert(visits).values({ user_id: actor.id, event_id: id, referrer_id: await referrerOf(db, actor, ref) });
  await addContact(db, event.user_id, actor.id);
}

/** Фиксирует заход на собранное событие. */
export async function visitCollectedEvent(db: Db, actor: User, slug: string, { ref }: VisitInput): Promise<void> {
  const [row] = await db
    .select({ external_id: collectedEvents.external_id, username: collectedEvents.telegram_username })
    .from(collectedEvents)
    .where(eq(collectedEvents.external_id, collectedExternalId(slug)));
  if (!row) throw new AppError('not_found', 404);
  // Организатор уже вошёл в Ясвами — человек сразу его контакт. Иначе остаётся только заход.
  // ponytail: заходы до входа организатора в контакты не переносятся; при входе их можно собрать из visits.
  const [host] = row.username
    ? await db.select({ user_id: hosts.user_id }).from(hosts).where(and(eq(hosts.username, row.username), isNotNull(hosts.user_id)))
    : [];
  if (host?.user_id) await addContact(db, host.user_id, actor.id);
  await db.insert(visits).values({ user_id: actor.id, collected_external_id: row.external_id, referrer_id: await referrerOf(db, actor, ref) });
}

/** Собранные события, куда человек заходил или записывался, — для «Моих событий». */
export async function myCollectedEvents(db: Db, actor: User): Promise<MyCollectedItem[]> {
  const signed = db.select({ id: collectedEventSignups.external_id }).from(collectedEventSignups).where(eq(collectedEventSignups.user_id, actor.id));
  const seen = db.select({ id: visits.collected_external_id }).from(visits).where(and(eq(visits.user_id, actor.id), isNotNull(visits.collected_external_id)));
  const signedIds = new Set((await signed).map((r) => r.id));
  const rows = await db
    .select()
    .from(collectedEvents)
    .where(or(inArray(collectedEvents.external_id, signed), inArray(collectedEvents.external_id, seen)))
    .orderBy(asc(collectedEvents.starts_at));
  return rows.map((r) => ({ event: toCollectedItem(r), signed_up: signedIds.has(r.external_id) }));
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
    await assertUnderLimit(tx, actor);
    const id = newEventId();
    const { ticket_types, ...fields } = input;
    await tx.insert(events).values({
      ...fields, id, user_id: actor.id, start_at: new Date(input.start_at),
      end_at: input.end_at ? new Date(input.end_at) : null, status: input.status ?? 'published',
    });
    // У события всегда есть хотя бы один тип билета.
    const types = ticket_types?.length ? ticket_types : [{}];
    await tx.insert(ticketTypes).values(types.map((t, position) => ({ ...t, name: t.name ?? DEFAULT_TICKET_NAME, event_id: id, position })));
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
  let registered = false; // гость только что записался: до этого ответа «пойду» у него не было
  const view = await db.transaction(async (tx) => {
    // Блокировка строки события: два гостя не займут одно последнее место.
    const event = await findEvent(tx, actor, id, true);
    const before = await tx.select().from(guests).where(eq(guests.event_id, id));
    const result = rsvp({
      event,
      ticketTypes: await typesOf(tx, id),
      guests: before,
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
      await addContact(tx, event.user_id, actor.id);
      registered = approval_status === 'approved' && before.find((g) => g.user_id === actor.id)?.approval_status !== 'approved';
    }
    return getEvent(tx, actor, id);
  });
  // После фиксации записи и без ожидания: недоступный Telegram не задерживает и не ломает ответ гостю.
  if (registered) guestRegistered(db, view.event, actor);
  return view;
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
