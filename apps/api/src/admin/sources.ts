// Источники сборщика (Source): каналы и группы, откуда он берёт анонсы, вопросы и мастеров (kind). Пишут сюда сборщик (CHANNELS при старте,
// каналы организаторов каждый проход) и команда — через журнал.
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { AdminSource, SourceCreateInput, SourceSearch, SourceSearchCreateInput, SourceUpdateInput } from '@yaswami/core';
import { sourceChannel } from '@yaswami/core';
import type { Ctx } from '../audit.ts';
import { audited } from '../audit.ts';
import type { Db } from '../db/client.ts';
import { calendars, cities, hosts, sourceSearches, sources } from '../db/schema.ts';
import { AppError, assertCity, sameChannel } from '../services.ts';
import { adoptForHost, calendarHost, newCalendar } from './calendars.ts';

const selectSources = (db: Db) => db
  .select({
    channel: sources.channel, kind: sources.kind, enabled: sources.enabled, disabled_reason: sources.disabled_reason, city_id: sources.city_id, created_at: sources.created_at,
    calendar: { id: calendars.id, name: calendars.name }, host_id: hosts.id, host_name: hosts.name, host_username: hosts.username,
    events_count: sql<number>`(select count(*) from collected_events e where lower(e.channel) = lower(${sources.channel}))::int`,
  })
  .from(sources).innerJoin(calendars, eq(calendars.id, sources.calendar_id)).leftJoin(hosts, eq(hosts.id, calendars.host_id));
type SourceRow = Awaited<ReturnType<typeof selectSources>>[number];
const toSource = ({ host_id, host_name, host_username, ...r }: SourceRow): AdminSource => ({ ...r, host: host_id && host_name && host_username ? { id: host_id, name: host_name, username: host_username } : null });

async function getSource(db: Db, channel: string): Promise<AdminSource> {
  const [row] = await selectSources(db).where(sameChannel(channel));
  if (!row) throw new AppError('not_found', 404);
  return toSource(row);
}

/** Все источники, новые сверху. ponytail: без страниц — каналов сотни, не тысячи. */
export const listSources = async (db: Db): Promise<AdminSource[]> => (await selectSources(db).orderBy(desc(sources.created_at)).limit(1000)).map(toSource);

/**
 * Добавить источник командой: сборщик начнёт читать его со следующего прохода. С `calendar_id` — в этот календарь
 * (например, Instagram уже добавленного канала), без него — в новый свой.
 */
export const createSource = (db: Db, ctx: Ctx, input: SourceCreateInput): Promise<AdminSource> =>
  audited(db, ctx, { action: 'admin_sources_create', entity: 'source', id: (r) => r.channel, input }, async (tx) => {
    const channel = sourceChannel(input.channel);
    await assertCity(tx, input.city_id);
    const host = input.calendar_id ? await calendarHost(tx, input.calendar_id) : null;
    const calendar_id = input.calendar_id ?? await newCalendar(tx, channel);
    const added = await tx.insert(sources).values({ channel, calendar_id, city_id: input.city_id, kind: input.kind }).onConflictDoNothing().returning();
    if (!added.length) throw new AppError('source_exists', 409); // новый календарь откатится вместе с действием
    if (host) await adoptForHost(tx, channel, host);
    return getSource(tx, channel);
  });

/**
 * Включить или выключить источник, перенести его в другой календарь или отделить в свой. Выключенный остаётся в
 * таблице: иначе канал организатора добавился бы снова. Перенесли в календарь организатора — источник становится
 * его источником (adoptForHost): сборщик перечитает свежие публикации, анонсы без контакта получат контактом этого
 * организатора.
 */
export async function updateSource(db: Db, ctx: Ctx, channel: string, input: SourceUpdateInput): Promise<AdminSource> {
  // Журнал и снимок — по каналу так, как он записан: команда может передать его в другом регистре.
  const { channel: key } = await getSource(db, channel);
  return audited(db, ctx, { action: 'admin_sources_update', entity: 'source', id: key, input }, async (tx) => {
    await assertCity(tx, input.city_id);
    const before = await getSource(tx, key);
    const host = input.calendar_id ? await calendarHost(tx, input.calendar_id) : null;
    const calendar_id = input.calendar_id === null ? await newCalendar(tx, key) : input.calendar_id;
    const values: Record<string, unknown> = Object.fromEntries(Object.entries({ enabled: input.enabled, kind: input.kind, calendar_id, city_id: input.city_id }).filter(([, v]) => v !== undefined));
    if (input.enabled !== undefined) values.disabled_reason = null; // решение команды заменяет причину сборщика
    if (Object.keys(values).length) await tx.update(sources).set(values).where(eq(sources.channel, key));
    if (host && host !== before.host?.id) await adoptForHost(tx, key, host);
    return getSource(tx, key);
  });
}

// --- Поиск источников для города (SourceSearch): ищет сборщик, у него сессия Telegram; API ставит заявку и отдаёт итог.

type SearchRow = typeof sourceSearches.$inferSelect;
const toSearch = (row: SearchRow, known: Set<string>): SourceSearch =>
  ({ ...row, results: row.results.map((r) => ({ ...r, added: known.has(r.channel.toLowerCase()) })) });
const knownChannels = async (db: Db) => new Set((await db.select({ channel: sources.channel }).from(sources)).map((r) => r.channel.toLowerCase()));

/** Последние поиски, новые сверху; `city_id` — только этого города. */
export async function listSourceSearches(db: Db, city_id?: string): Promise<SourceSearch[]> {
  const rows = await db.select().from(sourceSearches).where(city_id ? eq(sourceSearches.city_id, city_id) : undefined)
    .orderBy(desc(sourceSearches.created_at)).limit(20);
  const known = await knownChannels(db);
  return rows.map((r) => toSearch(r, known));
}

/**
 * Попросить сборщик найти источники города. Ищет он в следующий проход, несколько минут. Пока поиск города ждёт или
 * идёт, второй не ставится — возвращается тот же: поиск в Telegram флудоопасен.
 */
export const requestSourceSearch = (db: Db, ctx: Ctx, { city_id }: SourceSearchCreateInput): Promise<SourceSearch> =>
  audited(db, ctx, { action: 'admin_source_searches_create', entity: 'city', id: city_id, input: { city_id }, undoable: false }, async (tx) => {
    const [city] = await tx.select().from(cities).where(eq(cities.id, city_id));
    if (!city) throw new AppError('city_not_found', 404);
    const [busy] = await tx.select().from(sourceSearches)
      .where(and(eq(sourceSearches.city_id, city_id), inArray(sourceSearches.status, ['queued', 'running'])));
    const names = [...new Set([city.name, ...city.aliases])];
    const [row] = busy ? [busy] : await tx.insert(sourceSearches).values({ city_id, names }).returning();
    return toSearch(row!, await knownChannels(tx));
  });
