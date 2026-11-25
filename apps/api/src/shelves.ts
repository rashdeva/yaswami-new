// Витрина города из полок (core/shelves.ts, ADR-0009). Гостю — опубликованные полки с событиями; команде и куратору —
// все полки и их правка через журнал. Куратор — токен с областью `curator` (роль agents/curator).
import { and, asc, count, eq, gt, isNull, like, or, sql } from 'drizzle-orm';
import type { AdminShelf, CollectedEventItem, Shelf, ShelfCreateInput, ShelfListInput, ShelfUpdateInput, Showcase, ShowcaseShelf } from '@yaswami/core';
import { CURATOR_DAILY_CHANGES, DEFAULT_CITY_ID, DEFAULT_SHELVES, MIN_SHELF_EVENTS, cityNow, shelfEvents } from '@yaswami/core';
import type { Ctx } from './audit.ts';
import { audited } from './audit.ts';
import type { Db, Tx } from './db/client.ts';
import { adminActions, cities, shelves } from './db/schema.ts';
import { AppError, listCollectedEvents } from './services.ts';

const UUID = /^[0-9a-f-]{36}$/i;
const PREVIEW = 5;

async function cityOrFail(db: Db | Tx, id: string) {
  const [city] = await db.select().from(cities).where(eq(cities.id, id));
  if (!city) throw new AppError('city_not_found', 404);
  return city;
}

/** Предстоящие события города и «сегодня» по его часам — всё, из чего считаются полки. */
async function cityEvents(db: Db | Tx, city_id: string) {
  const city = await cityOrFail(db, city_id);
  const upcoming = await listCollectedEvents(db, { city_id });
  return { city, upcoming, today: cityNow(city.timezone).day };
}

const live = (now = new Date()) => or(isNull(shelves.ends_at), gt(shelves.ends_at, now));

/**
 * Витрина города для гостя: опубликованные полки, на которых сейчас не меньше MIN_SHELF_EVENTS событий. У города без
 * своих полок — полки по умолчанию (DEFAULT_SHELVES): витрина работает до первой правки команды и куратора.
 */
export async function getShowcase(db: Db, { city_id = DEFAULT_CITY_ID }: ShelfListInput = {}): Promise<Showcase> {
  const { upcoming, today } = await cityEvents(db, city_id);
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(shelves).where(eq(shelves.city_id, city_id));
  const source: Pick<Shelf, 'id' | 'title' | 'topic' | 'author' | 'rule' | 'event_ids'>[] = n
    ? await db.select().from(shelves)
      .where(and(eq(shelves.city_id, city_id), eq(shelves.status, 'published'), live()))
      .orderBy(asc(shelves.position), asc(shelves.created_at))
    : DEFAULT_SHELVES.map((s, i) => ({ ...s, id: `default-${i}`, author: 'team' as const, event_ids: [] }));
  const result: ShowcaseShelf[] = [];
  for (const s of source) {
    const events = shelfEvents(s, upcoming, today);
    if (events.length >= MIN_SHELF_EVENTS) result.push({ id: s.id, title: s.title, topic: s.topic, author: s.author, events });
  }
  return { city_id, shelves: result };
}

const brief = (e: CollectedEventItem) => ({ id: e.id, title: e.title, starts_at: e.starts_at, topic: e.topic });
const toAdmin = (s: Shelf, upcoming: CollectedEventItem[], today: string): AdminShelf => {
  const events = shelfEvents(s, upcoming, today);
  return { ...s, events_count: events.length, events: events.slice(0, PREVIEW).map(brief) };
};

/** Все полки города, с предложенными и снятыми, в порядке витрины. Пусто — гость видит полки по умолчанию. */
export async function listShelves(db: Db, { city_id = DEFAULT_CITY_ID }: ShelfListInput = {}): Promise<AdminShelf[]> {
  const { upcoming, today } = await cityEvents(db, city_id);
  const rows = await db.select().from(shelves).where(eq(shelves.city_id, city_id)).orderBy(asc(shelves.position), asc(shelves.created_at));
  return rows.map((s) => toAdmin(s, upcoming, today));
}

async function shelfOrFail(db: Db | Tx, id: string): Promise<Shelf> {
  const [shelf] = UUID.test(id) ? await db.select().from(shelves).where(eq(shelves.id, id)) : [];
  if (!shelf) throw new AppError('not_found', 404);
  return shelf;
}

const isCurator = (ctx: Ctx) => ctx.scope === 'curator';

/** Куратор меняет витрину не чаще CURATOR_DAILY_CHANGES раз в сутки: счёт — по журналу (автор пишется во вход). */
async function assertCuratorBudget(db: Db | Tx) {
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(adminActions).where(and(
    like(adminActions.action, 'admin_shelves_%'), sql`${adminActions.input}->>'author' = 'curator'`, gt(adminActions.created_at, sql`now() - interval '1 day'`),
  ));
  if (n >= CURATOR_DAILY_CHANGES) throw new AppError('too_many_changes', 409);
}

/**
 * Что куратору можно с этой полкой. Закреплённые и полки команды — только смотреть. В городе с режимом draft он
 * правит лишь свои предложенные полки и не публикует их: решает команда.
 */
function assertCuratorMay(shelf: Shelf, mode: 'draft' | 'auto') {
  if (shelf.author === 'team' || shelf.pinned) throw new AppError('shelf_locked', 409);
  if (mode === 'draft' && shelf.status !== 'proposed') throw new AppError('showcase_draft', 409);
}

/** Ручная полка — только из предстоящих опубликованных событий города и соседей: витрина не покажет выдуманного. */
async function assertEvents(db: Db | Tx, city_id: string, ids: string[] | undefined) {
  if (!ids?.length) return;
  const known = new Set((await listCollectedEvents(db, { city_id })).map((e) => e.id));
  if (ids.some((id) => !known.has(id))) throw new AppError('event_not_found', 404);
}

/** Новая полка. Куратор в городе с режимом draft получает предложенную (proposed) — гости её не видят до решения команды. */
export async function createShelf(db: Db, ctx: Ctx, input: ShelfCreateInput): Promise<AdminShelf> {
  const curator = isCurator(ctx);
  const author = curator ? 'curator' as const : 'team' as const;
  const shelf = await audited<Shelf>(db, ctx, { action: 'admin_shelves_create', entity: 'shelf', id: (s) => s.id, input: { ...input, author } }, async (tx) => {
    const city = await cityOrFail(tx, input.city_id);
    if (!input.rule && !input.event_ids?.length) throw new AppError('shelf_empty', 400);
    await assertEvents(tx, city.id, input.rule ? undefined : input.event_ids);
    let status = input.status ?? 'published';
    if (curator) {
      if (input.pinned) throw new AppError('forbidden', 403);
      await assertCuratorBudget(tx);
      if (city.showcase_mode === 'draft') status = 'proposed';
    }
    const [created] = await tx.insert(shelves).values({
      city_id: city.id, title: input.title, topic: input.topic ?? null, rule: input.rule ?? null, event_ids: input.rule ? [] : input.event_ids ?? [],
      position: input.position ?? sql`(select coalesce(max(position), -1) + 1 from shelves where city_id = ${city.id})`,
      status, pinned: !curator && !!input.pinned, author, note: input.note ?? null, ends_at: input.ends_at ? new Date(input.ends_at) : null,
    }).returning();
    return created!;
  });
  const { upcoming, today } = await cityEvents(db, shelf.city_id);
  return toAdmin(shelf, upcoming, today);
}

/**
 * Правка полки, только переданные поля. Правка человека закрепляет полку (куратор её больше не тронет), если он
 * сам не передал `pinned: false`.
 */
export async function updateShelf(db: Db, ctx: Ctx, id: string, input: ShelfUpdateInput): Promise<AdminShelf> {
  const curator = isCurator(ctx);
  await shelfOrFail(db, id);
  const shelf = await audited<Shelf>(db, ctx, { action: 'admin_shelves_update', entity: 'shelf', id, input: { ...input, author: curator ? 'curator' : 'team' } }, async (tx) => {
    const current = await shelfOrFail(tx, id);
    const city = await cityOrFail(tx, current.city_id);
    if (curator) {
      if (input.pinned !== undefined) throw new AppError('forbidden', 403);
      assertCuratorMay(current, city.showcase_mode);
      if (city.showcase_mode === 'draft' && input.status === 'published') throw new AppError('showcase_draft', 409);
      await assertCuratorBudget(tx);
    }
    const rule = input.rule === undefined ? current.rule : input.rule;
    const event_ids = rule ? [] : input.event_ids ?? current.event_ids;
    if (!rule && !event_ids.length) throw new AppError('shelf_empty', 400);
    if (!rule && input.event_ids) await assertEvents(tx, city.id, input.event_ids);
    const { ends_at, ...rest } = input;
    const [updated] = await tx.update(shelves).set({
      ...rest, rule, event_ids,
      ...(ends_at !== undefined ? { ends_at: ends_at ? new Date(ends_at) : null } : {}),
      pinned: curator ? current.pinned : input.pinned ?? true,
      updated_at: new Date(),
    }).where(eq(shelves.id, id)).returning();
    return updated!;
  });
  const { upcoming, today } = await cityEvents(db, shelf.city_id);
  return toAdmin(shelf, upcoming, today);
}

/** Удалить полку. Куратор — только свою незакреплённую (в режиме draft — только предложенную). */
export async function deleteShelf(db: Db, ctx: Ctx, id: string): Promise<void> {
  const curator = isCurator(ctx);
  await shelfOrFail(db, id);
  await audited(db, ctx, { action: 'admin_shelves_delete', entity: 'shelf', id, input: { author: curator ? 'curator' : 'team' } }, async (tx) => {
    const current = await shelfOrFail(tx, id);
    if (curator) {
      assertCuratorMay(current, (await cityOrFail(tx, current.city_id)).showcase_mode);
      await assertCuratorBudget(tx);
    }
    await tx.delete(shelves).where(eq(shelves.id, id));
  });
}
