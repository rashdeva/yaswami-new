// Источники сборщика (Source): каналы и группы, откуда он берёт анонсы, вопросы, мастеров и вакансии (kind). Пишут сюда сборщик (CHANNELS при старте,
// каналы организаторов каждый проход) и команда — через журнал.
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { AdminSource, SourceCreateInput, SourceSearch, SourceSearchCreateInput, SourceUpdateInput } from '@yaswami/core';
import type { Ctx } from '../audit.ts';
import { audited } from '../audit.ts';
import type { Db } from '../db/client.ts';
import { cities, collectorCursors, hosts, sourceSearches, sources } from '../db/schema.ts';
import { AppError, assertCity, sameChannel } from '../services.ts';

const selectSources = (db: Db) => db
  .select({
    channel: sources.channel, kind: sources.kind, enabled: sources.enabled, disabled_reason: sources.disabled_reason, city_id: sources.city_id, created_at: sources.created_at, host_id: hosts.id, host_name: hosts.name, host_username: hosts.username,
    events_count: sql<number>`(select count(*) from collected_events e where lower(e.channel) = lower(${sources.channel}))::int`,
  })
  .from(sources).leftJoin(hosts, eq(hosts.id, sources.host_id));
type SourceRow = Awaited<ReturnType<typeof selectSources>>[number];
const toSource = ({ host_id, host_name, host_username, ...r }: SourceRow): AdminSource => ({ ...r, host: host_id && host_name && host_username ? { id: host_id, name: host_name, username: host_username } : null });

async function getSource(db: Db, channel: string): Promise<AdminSource> {
  const [row] = await selectSources(db).where(sameChannel(channel));
  if (!row) throw new AppError('not_found', 404);
  return toSource(row);
}

/** Все источники, новые сверху. ponytail: без страниц — каналов сотни, не тысячи. */
export const listSources = async (db: Db): Promise<AdminSource[]> => (await selectSources(db).orderBy(desc(sources.created_at)).limit(1000)).map(toSource);

/** Добавить источник командой: сборщик начнёт читать его со следующего прохода. */
export const createSource = (db: Db, ctx: Ctx, input: SourceCreateInput): Promise<AdminSource> =>
  audited(db, ctx, { action: 'admin_sources_create', entity: 'source', id: (r) => r.channel, input }, async (tx) => {
    const channel = input.channel.replace(/^(?:https?:\/\/)?(?:t\.me\/|@)?/, '').replace(/\/$/, '');
    await assertCity(tx, input.city_id);
    const added = await tx.insert(sources).values({ channel, city_id: input.city_id, kind: input.kind }).onConflictDoNothing().returning();
    if (!added.length) throw new AppError('source_exists', 409);
    return getSource(tx, channel);
  });

/**
 * Включить или выключить источник, указать или убрать его организатора. Выключенный остаётся в таблице: иначе канал
 * организатора добавился бы снова.
 *
 * Указали нового организатора — сборщик перечитает свежие публикации канала (не старше MAX_AGE_DAYS): анонсы без
 * контакта, которые он раньше пропустил, теперь получат контактом организатора. А если у организатора нет канала,
 * этот канал становится его каналом: из него берутся фото сообщества.
 */
export async function updateSource(db: Db, ctx: Ctx, channel: string, input: SourceUpdateInput): Promise<AdminSource> {
  // Журнал и снимок — по каналу так, как он записан: команда может передать его в другом регистре.
  const { channel: key } = await getSource(db, channel);
  return audited(db, ctx, { action: 'admin_sources_update', entity: 'source', id: key, input }, async (tx) => {
    if (input.host_id && !(await tx.select({ id: hosts.id }).from(hosts).where(eq(hosts.id, input.host_id))).length) throw new AppError('host_not_found', 404);
    await assertCity(tx, input.city_id);
    const values = Object.fromEntries(Object.entries({ enabled: input.enabled, kind: input.kind, host_id: input.host_id, city_id: input.city_id }).filter(([, v]) => v !== undefined));
    if (input.enabled !== undefined) values.disabled_reason = null; // решение команды заменяет причину сборщика
    const before = await getSource(tx, key);
    if (Object.keys(values).length) await tx.update(sources).set(values).where(eq(sources.channel, key));
    if (input.host_id && input.host_id !== before.host?.id) {
      await tx.delete(collectorCursors).where(eq(collectorCursors.channel, key));
      // ponytail: канал организатора — не часть снимка источника, отмена действия его не вернёт; поправить — в карточке организатора.
      if (!key.startsWith('-')) await tx.update(hosts).set({ channel: key.toLowerCase() }).where(and(eq(hosts.id, input.host_id), isNull(hosts.channel)));
    }
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
