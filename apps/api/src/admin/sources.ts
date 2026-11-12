// Источники сборщика (Source): каналы и группы, откуда он берёт анонсы. Пишут сюда сборщик (CHANNELS при старте,
// каналы организаторов каждый проход) и команда — через журнал.
import { desc, eq, sql } from 'drizzle-orm';
import type { AdminSource, SourceCreateInput, SourceUpdateInput } from '@yaswami/core';
import type { Ctx } from '../audit.ts';
import { audited } from '../audit.ts';
import type { Db } from '../db/client.ts';
import { hosts, sources } from '../db/schema.ts';
import { AppError } from '../services.ts';

// Username в Telegram не различает регистр, поэтому сравниваем по lower().
const sameChannel = (channel: string) => sql`lower(${sources.channel}) = lower(${channel})`;
const selectSources = (db: Db) => db
  .select({
    channel: sources.channel, enabled: sources.enabled, created_at: sources.created_at, host_name: hosts.name, host_username: hosts.username,
    events_count: sql<number>`(select count(*) from collected_events e where lower(e.channel) = lower(${sources.channel}))::int`,
  })
  .from(sources).leftJoin(hosts, eq(hosts.id, sources.host_id));
type SourceRow = Awaited<ReturnType<typeof selectSources>>[number];
const toSource = ({ host_name, host_username, ...r }: SourceRow): AdminSource => ({ ...r, host: host_name && host_username ? { name: host_name, username: host_username } : null });

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
    const added = await tx.insert(sources).values({ channel }).onConflictDoNothing().returning();
    if (!added.length) throw new AppError('source_exists', 409);
    return getSource(tx, channel);
  });

/** Включить или выключить источник. Выключенный остаётся в таблице: иначе канал организатора добавился бы снова. */
export async function updateSource(db: Db, ctx: Ctx, channel: string, input: SourceUpdateInput): Promise<AdminSource> {
  // Журнал и снимок — по каналу так, как он записан: команда может передать его в другом регистре.
  const { channel: key } = await getSource(db, channel);
  return audited(db, ctx, { action: 'admin_sources_update', entity: 'source', id: key, input }, async (tx) => {
    await tx.update(sources).set({ enabled: input.enabled }).where(eq(sources.channel, key));
    return getSource(tx, key);
  });
}
