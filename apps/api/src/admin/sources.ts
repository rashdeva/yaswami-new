// Источники сборщика (Source): каналы и группы, откуда он берёт анонсы, вопросы и мастеров (kind). Пишут сюда сборщик (CHANNELS при старте,
// каналы организаторов каждый проход) и команда — через журнал.
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { AdminSource, SourceCreateInput, SourceSearch, SourceSearchCreateInput, SourceUpdateInput } from '@yaswami/core';
import { instagramOf, sourceChannel } from '@yaswami/core';
import type { Ctx } from '../audit.ts';
import { afterCommit, audited } from '../audit.ts';
import { botChatIdOf } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { cities, collectorCursors, hosts, sourceSearches, sources, users } from '../db/schema.ts';
import { sendCard } from '../notifications.ts';
import { AppError, assertCity, sameChannel } from '../services.ts';

const selectSources = (db: Db) => db
  .select({
    channel: sources.channel, kind: sources.kind, enabled: sources.enabled, disabled_reason: sources.disabled_reason, empty_parses: sources.empty_parses, city_id: sources.city_id, created_at: sources.created_at, host_id: hosts.id, host_name: hosts.name, host_username: hosts.username,
    approval_status: sources.approval_status, submitter_id: users.id, submitter_name: users.first_name, submitter_username: users.username,
    events_count: sql<number>`(select count(*) from collected_events e where lower(e.channel) = lower(${sources.channel}))::int`,
  })
  .from(sources).leftJoin(hosts, eq(hosts.id, sources.host_id)).leftJoin(users, eq(users.id, sources.submitted_by));
type SourceRow = Awaited<ReturnType<typeof selectSources>>[number];
const toSource = ({ host_id, host_name, host_username, submitter_id, submitter_name, submitter_username, ...r }: SourceRow): AdminSource => ({
  ...r,
  host: host_id && host_name && host_username ? { id: host_id, name: host_name, username: host_username } : null,
  submitted_by: submitter_id !== null && submitter_name !== null ? { id: submitter_id, first_name: submitter_name, username: submitter_username } : null,
});

async function getSource(db: Db, channel: string): Promise<AdminSource> {
  const [row] = await selectSources(db).where(sameChannel(channel));
  if (!row) throw new AppError('not_found', 404);
  return toSource(row);
}

/** Все источники, новые сверху, и предложенные людьми — с тем, кто предложил. ponytail: без страниц — каналов сотни, не тысячи. */
export const listSources = async (db: Db): Promise<AdminSource[]> => (await selectSources(db).orderBy(desc(sources.created_at)).limit(1000)).map(toSource);

/** Добавить источник командой: сборщик начнёт читать его со следующего прохода. */
export const createSource = (db: Db, ctx: Ctx, input: SourceCreateInput): Promise<AdminSource> =>
  audited(db, ctx, { action: 'admin_sources_create', entity: 'source', id: (r) => r.channel, input }, async (tx) => {
    const channel = sourceChannel(input.channel);
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
 * этот канал становится его каналом: из него берутся фото сообщества. Профиль Instagram так же становится его
 * Instagram, если тот не указан.
 *
 * Решение по предложенному источнику (`approval_status`): одобренный включается, и бот пишет тому, кто его предложил;
 * отклонённый остаётся выключенным. Одобрение с сообщением человеку не отменяется: оно уже ушло в Telegram.
 */
export async function updateSource(db: Db, ctx: Ctx, channel: string, input: SourceUpdateInput): Promise<AdminSource> {
  // Журнал и снимок — по каналу так, как он записан: команда может передать его в другом регистре.
  const { channel: key, approval_status: was, submitted_by } = await getSource(db, channel);
  const tell = input.approval_status === 'approved' && was !== 'approved' ? submitted_by : null; // кому написать об одобрении
  return audited(db, ctx, { action: 'admin_sources_update', entity: 'source', id: key, input, undoable: !tell }, async (tx) => {
    if (input.host_id && !(await tx.select({ id: hosts.id }).from(hosts).where(eq(hosts.id, input.host_id))).length) throw new AppError('host_not_found', 404);
    await assertCity(tx, input.city_id);
    // Решение по предложенному включает или выключает его; явное `enabled` в том же вызове главнее.
    const enabled = input.enabled ?? (input.approval_status ? input.approval_status === 'approved' : undefined);
    const values: Partial<typeof sources.$inferInsert> = Object.fromEntries(Object.entries({ enabled, kind: input.kind, host_id: input.host_id, city_id: input.city_id, approval_status: input.approval_status }).filter(([, v]) => v !== undefined));
    if (enabled !== undefined) values.disabled_reason = null; // решение команды заменяет причину сборщика
    if (enabled) values.empty_parses = 0; // включили — счёт пустых разборов заново, иначе первый же выключит снова
    const before = await getSource(tx, key);
    if (Object.keys(values).length) await tx.update(sources).set(values).where(eq(sources.channel, key));
    // Включили выключенный источник товаров — сборщик перечитает его свежие посты: так команда возвращает пропущенное.
    if (input.enabled && !before.enabled && (input.kind ?? before.kind) === 'products') await tx.delete(collectorCursors).where(eq(collectorCursors.channel, `product:${key}`));
    if (input.host_id && input.host_id !== before.host?.id) {
      // У товаров своя отметка — product:<канал> (pollProducts в сборщике): перечитать нужно и их.
      await tx.delete(collectorCursors).where(inArray(collectorCursors.channel, [key, `product:${key}`]));
      // ponytail: канал организатора — не часть снимка источника, отмена действия его не вернёт; поправить — в карточке организатора.
      const instagram = instagramOf(key);
      if (instagram) await tx.update(hosts).set({ instagram_handle: instagram }).where(and(eq(hosts.id, input.host_id), isNull(hosts.instagram_handle)));
      else if (!key.startsWith('-')) await tx.update(hosts).set({ channel: key.toLowerCase() }).where(and(eq(hosts.id, input.host_id), isNull(hosts.channel)));
    }
    if (tell) {
      afterCommit(tx, async (base) => {
        const chatId = await botChatIdOf(base, tell.id); // users.id — не Telegram id (ADR-0008)
        if (chatId !== null) await sendCard(chatId, 'source_approved', { channel: key });
      });
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
