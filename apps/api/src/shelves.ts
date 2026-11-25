// Витрина города из полок (core/shelves.ts, ADR-0009). Гостю — опубликованные полки с событиями; команде и куратору —
// все полки и их правка через журнал. Куратор — токен с областью `curator` (роль agents/curator).
import { and, asc, count, eq, gt, isNull, like, lte, max, or, sql } from 'drizzle-orm';
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
 * Витрина города для гостя: опубликованные действующие полки, на которых сейчас не меньше MIN_SHELF_EVENTS событий.
 * Не набралось ни одной (своих полок нет, все предложены, сняты, истекли или полупустые) — полки по умолчанию
 * (DEFAULT_SHELVES): главная не должна оставаться пустой, пока команда не опубликует своё.
 */
export async function getShowcase(db: Db, { city_id = DEFAULT_CITY_ID }: ShelfListInput = {}): Promise<Showcase> {
  const { upcoming, today } = await cityEvents(db, city_id);
  const own = await db.select().from(shelves)
    .where(and(eq(shelves.city_id, city_id), eq(shelves.status, 'published'), live()))
    .orderBy(asc(shelves.position), asc(shelves.created_at));
  const filled = (list: Pick<Shelf, 'id' | 'title' | 'topic' | 'author' | 'rule' | 'event_ids'>[]): ShowcaseShelf[] => list.flatMap((s) => {
    const events = shelfEvents(s, upcoming, today);
    return events.length >= MIN_SHELF_EVENTS ? [{ id: s.id, title: s.title, topic: s.topic, author: s.author, events }] : [];
  });
  const shown = filled(own);
  return { city_id, shelves: shown.length ? shown : filled(DEFAULT_SHELVES.map((s, i) => ({ ...s, id: `default-${i}`, author: 'team' as const, event_ids: [] }))) };
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

/**
 * Ручная полка — только из предстоящих опубликованных событий города и соседей: витрина не покажет выдуманного.
 * `kept` — события, которые уже стоят на полке: прошедшее среди них не мешает сохранить правку (витрина его и так не
 * покажет), отказ — только за новое неизвестное.
 */
async function assertEvents(db: Db | Tx, city_id: string, ids: string[] | undefined, kept: string[] = []) {
  if (!ids?.length) return;
  const known = new Set([...(await listCollectedEvents(db, { city_id })).map((e) => e.id), ...kept]);
  if (ids.some((id) => !known.has(id))) throw new AppError('event_not_found', 404);
}

/**
 * Выше какого места куратору нельзя: полки команды и закреплённые, что стоят на месте `from` или выше (новая полка —
 * все такие), остаются над его полкой. Возвращает наименьшую позицию, которую куратор может занять.
 */
async function curatorFloor(db: Db | Tx, city_id: string, from: number | null): Promise<number> {
  const [{ top } = { top: null }] = await db.select({ top: max(shelves.position) }).from(shelves).where(and(
    eq(shelves.city_id, city_id), or(eq(shelves.author, 'team'), eq(shelves.pinned, true)), from === null ? undefined : lte(shelves.position, from),
  ));
  return top === null ? 0 : top + 1;
}

/** Правка содержимого полки (а не места или статуса): после неё правка человека закрепляет полку. */
const CONTENT = ['title', 'topic', 'rule', 'event_ids', 'note', 'ends_at'] as const;

/** Новая полка. Куратор в городе с режимом draft получает предложенную (proposed) — гости её не видят до решения команды. */
export async function createShelf(db: Db, ctx: Ctx, input: ShelfCreateInput): Promise<AdminShelf> {
  const curator = isCurator(ctx);
  const author = curator ? 'curator' as const : 'team' as const;
  const shelf = await audited<Shelf>(db, ctx, { action: 'admin_shelves_create', entity: 'shelf', id: (s) => s.id, input: { ...input, author } }, async (tx) => {
    const city = await cityOrFail(tx, input.city_id);
    if (!input.rule && !input.event_ids?.length) throw new AppError('shelf_empty', 400);
    await assertEvents(tx, city.id, input.rule ? undefined : input.event_ids);
    let status = input.status ?? 'published';
    let position = input.position;
    if (curator) {
      if (input.pinned) throw new AppError('forbidden', 403);
      await assertCuratorBudget(tx);
      if (city.showcase_mode === 'draft') status = 'proposed';
      if (position !== undefined) position = Math.max(position, await curatorFloor(tx, city.id, null));
    }
    const [created] = await tx.insert(shelves).values({
      city_id: city.id, title: input.title, topic: input.topic ?? null, rule: input.rule ?? null, event_ids: input.rule ? [] : input.event_ids ?? [],
      position: position ?? sql`(select coalesce(max(position), -1) + 1 from shelves where city_id = ${city.id})`,
      status, pinned: !curator && !!input.pinned, author, note: input.note ?? null, ends_at: input.ends_at ? new Date(input.ends_at) : null,
    }).returning();
    return created!;
  });
  const { upcoming, today } = await cityEvents(db, shelf.city_id);
  return toAdmin(shelf, upcoming, today);
}

/**
 * Правка полки, только переданные поля. Правка человеком содержимого (CONTENT) закрепляет полку — куратор её больше
 * не тронет, если человек сам не передал `pinned: false`; место и статус закрепление не меняют.
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
    const position = curator && input.position !== undefined ? Math.max(input.position, await curatorFloor(tx, city.id, current.position)) : input.position;
    const rule = input.rule === undefined ? current.rule : input.rule;
    const event_ids = rule ? [] : input.event_ids ?? current.event_ids;
    if (!rule && !event_ids.length) throw new AppError('shelf_empty', 400);
    if (!rule && input.event_ids) await assertEvents(tx, city.id, input.event_ids, current.event_ids);
    const edited = CONTENT.some((key) => input[key] !== undefined);
    const { ends_at, ...rest } = input;
    const [updated] = await tx.update(shelves).set({
      ...rest, rule, event_ids, position,
      ...(ends_at !== undefined ? { ends_at: ends_at ? new Date(ends_at) : null } : {}),
      pinned: curator ? current.pinned : input.pinned ?? (edited || current.pinned),
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
