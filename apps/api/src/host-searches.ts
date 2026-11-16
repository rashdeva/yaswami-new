// Запросы организатора и Находки по ним (CONTEXT.md). Ищет сборщик (apps/collector, lead.mjs и search.ts в extract):
// здесь только то, что делает сам организатор. Писать найденным людям он будет сам — мы им не пишем.
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { HostSearch, HostSearchCreateInput, HostSearchList, HostSearchMatchList, HostSearchMatchListInput, HostSearchUpdateInput, User } from '@yaswami/core';
import type { Db } from './db/client.ts';
import { hostSearches, hostSearchMatches, hosts, practices } from './db/schema.ts';
import { AppError } from './services.ts';

/** Профиль организатора, который человек подтвердил входом (auth.ts). Остальным Запросы недоступны. */
async function ownHost(db: Db, actor: User): Promise<string> {
  const [host] = await db.select({ id: hosts.id }).from(hosts).where(eq(hosts.user_id, actor.id));
  if (!host) throw new AppError('not_host', 403);
  return host.id;
}

async function ownSearch(db: Db, actor: User, id: string): Promise<HostSearch> {
  const hostId = await ownHost(db, actor);
  const [search] = await db.select().from(hostSearches).where(and(eq(hostSearches.id, id), eq(hostSearches.host_id, hostId)));
  if (!search) throw new AppError('not_found', 404);
  return search;
}

const SUGGESTIONS_MAX = 5;

/**
 * Запросы организатора. Пока их нет ни одного — предлагаем по его Practice: «ищут <что он ведёт>», выключенными.
 * ponytail: предложения только из названий Practice; по описанию профиля без Practice ничего не предлагаем —
 * добавить вывод ИИ, если таких организаторов окажется много. Удалил все — предложим снова: это не страшно.
 */
export async function listHostSearches(db: Db, actor: User): Promise<HostSearchList> {
  const hostId = await ownHost(db, actor);
  const mine = () => db.select().from(hostSearches).where(eq(hostSearches.host_id, hostId)).orderBy(asc(hostSearches.created_at));
  let entries = await mine();
  if (!entries.length) {
    const titles = await db.selectDistinct({ title: practices.title, position: practices.position }).from(practices)
      .where(and(eq(practices.host_id, hostId), inArray(practices.status, ['pending', 'published'])))
      .orderBy(asc(practices.position)).limit(SUGGESTIONS_MAX);
    if (titles.length) {
      await db.insert(hostSearches).values(titles.map((p) => ({ host_id: hostId, query: `ищут ${p.title.toLowerCase()}`, status: 'suggested' as const })));
      entries = await mine();
    }
  }
  return { entries };
}

export async function createHostSearch(db: Db, actor: User, input: HostSearchCreateInput): Promise<HostSearch> {
  const hostId = await ownHost(db, actor);
  const [search] = await db.insert(hostSearches).values({ host_id: hostId, query: input.query }).returning();
  return search!;
}

/** Включить, выключить или переписать Запрос. Новый текст — сборщик заново выведет ключевые слова. */
export async function updateHostSearch(db: Db, actor: User, id: string, input: HostSearchUpdateInput): Promise<HostSearch> {
  const search = await ownSearch(db, actor, id);
  const changed = input.query !== undefined && input.query !== search.query;
  const [updated] = await db.update(hostSearches)
    .set({ ...(input.status ? { status: input.status } : {}), ...(changed ? { query: input.query, keywords: null } : {}) })
    .where(eq(hostSearches.id, id)).returning();
  return updated!;
}

/** Удалить Запрос вместе с его Находками. */
export async function deleteHostSearch(db: Db, actor: User, id: string): Promise<void> {
  await ownSearch(db, actor, id);
  await db.delete(hostSearches).where(eq(hostSearches.id, id));
}

/** Находки по всем Запросам организатора, новые сверху, страницами. */
export async function listHostSearchMatches(db: Db, actor: User, input: HostSearchMatchListInput): Promise<HostSearchMatchList> {
  const hostId = await ownHost(db, actor);
  const limit = input.pagination_limit ?? 50;
  const rows = await db.select({ match: hostSearchMatches }).from(hostSearchMatches)
    .innerJoin(hostSearches, eq(hostSearches.id, hostSearchMatches.search_id))
    .where(and(
      eq(hostSearches.host_id, hostId),
      // Сравнение в базе: в JS время теряет микросекунды, и курсор промахнулся бы.
      input.pagination_cursor ? sql`(${hostSearchMatches.created_at}, ${hostSearchMatches.id}) < (select created_at, id from host_search_matches where id = ${input.pagination_cursor})` : undefined,
    ))
    .orderBy(desc(hostSearchMatches.created_at), desc(hostSearchMatches.id)).limit(limit + 1);
  const entries = rows.slice(0, limit).map((r) => r.match);
  const has_more = rows.length > limit;
  return { entries, has_more, next_cursor: has_more ? entries.at(-1)!.id : null };
}

