// Темы (Topic): список правят команда и агенты — через журнал. Сборщик добавляет темы сам (store.mjs).
import { asc, eq, sql } from 'drizzle-orm';
import type { AdminTopic, TopicCandidate, TopicCandidateListInput, TopicCreateInput, TopicUpdateInput } from '@yaswami/core';
import { hasBuiltInIcon, OTHER_TOPIC } from '@yaswami/core';
import type { Ctx } from '../audit.ts';
import { audited } from '../audit.ts';
import type { Db, Tx } from '../db/client.ts';
import { topics } from '../db/schema.ts';
import { AppError } from '../services.ts';
import { refreshTopics, setTopicIcon, topicFields, toTopicItem } from '../topics.ts';

const selectTopics = (db: Db | Tx) => db.select({
  ...topicFields,
  events_count: sql<number>`(select count(*) from collected_events e where e.event->>'topic' = ${topics.name})::int`,
}).from(topics);
type Row = Awaited<ReturnType<typeof selectTopics>>[number];
const toAdminTopic = (r: Row): AdminTopic => ({
  ...toTopicItem(r), tags: r.tags, enabled: r.enabled, origin: r.origin, has_icon: !!r.icon_at || hasBuiltInIcon(r.slug), events_count: r.events_count, created_at: r.created_at,
});

async function getTopic(db: Db | Tx, name: string): Promise<AdminTopic> {
  const [row] = await selectTopics(db).where(eq(topics.name, name));
  if (!row) throw new AppError('not_found', 404);
  return toAdminTopic(row);
}

/** Все темы, с выключенными, в порядке фильтров. */
export const listAllTopics = async (db: Db): Promise<AdminTopic[]> => (await selectTopics(db).orderBy(asc(topics.position), asc(topics.created_at))).map(toAdminTopic);

/**
 * События без темы («другое») с меткой темы переходят в неё. У услуг меток нет — их тему правит команда.
 * ponytail: в снимок журнала эти события не входят — отмена создания темы оставит им её имя, и они покажутся
 * как «другое»; вернуть — правкой события.
 */
const retag = (tx: Db | Tx, name: string, tags: string[]) => (tags.length
  ? tx.execute(sql`update collected_events set event = jsonb_set(event, '{topic}', to_jsonb(${name}::text))
      where event->>'topic' = ${OTHER_TOPIC} and exists (select 1 from jsonb_array_elements_text(event->'tags') t where lower(t) in ${tags})`)
  : null);

/** Новая тема: сразу видна людям и сборщику; иконку нарисует иллюстратор на следующем шаге очереди. */
export async function createTopic(db: Db, ctx: Ctx, input: TopicCreateInput): Promise<AdminTopic> {
  const created = await audited<AdminTopic>(db, ctx, { action: 'admin_topics_create', entity: 'topic', id: (r) => r.name, input }, async (tx) => {
    const added = await tx.insert(topics)
      .values({ ...input, color: input.color.toLowerCase(), origin: 'team', position: sql`(select coalesce(max(position), 0) + 1 from topics)` })
      .onConflictDoNothing().returning({ name: topics.name });
    if (!added.length) throw new AppError('topic_exists', 409); // занято имя или slug
    await retag(tx, input.name, input.tags);
    return getTopic(tx, input.name);
  });
  await refreshTopics(db);
  return created;
}

/** Правка гида, меток, цвета, иконки; выключение. Только переданные поля. */
export async function updateTopic(db: Db, ctx: Ctx, name: string, { icon_url, ...input }: TopicUpdateInput): Promise<AdminTopic> {
  await getTopic(db, name);
  // Картинку в журнал не пишем: data URL — это мегабайты.
  const updated = await audited<AdminTopic>(db, ctx, { action: 'admin_topics_update', entity: 'topic', id: name, input: { ...input, ...(icon_url ? { icon_url: icon_url.startsWith('data:') ? 'data:…' : icon_url } : {}) } }, async (tx) => {
    const values = Object.fromEntries(Object.entries({ ...input, color: input.color?.toLowerCase() }).filter(([, v]) => v !== undefined));
    if (Object.keys(values).length) await tx.update(topics).set(values).where(eq(topics.name, name));
    if (input.tags) await retag(tx, name, input.tags);
    if (icon_url) await setTopicIcon(tx, name, icon_url);
    return getTopic(tx, name);
  });
  await refreshTopics(db);
  return updated;
}

const CANDIDATE_DAYS = 90;

/**
 * Кандидаты в темы: Tag событий без темы за последние CANDIDATE_DAYS дней, кроме меток существующих тем.
 * Считаются и отклонённые события: тему могли не публиковать именно потому, что её не было.
 */
export async function listTopicCandidates(db: Db, { min_events }: TopicCandidateListInput): Promise<TopicCandidate[]> {
  const rows = await db.execute<{ tag: string; events_count: number; hosts_count: number; examples: string[] }>(sql`
    select lower(t) as tag, count(*)::int as events_count, count(distinct coalesce(e.telegram_username, e.channel))::int as hosts_count,
      (array_agg(e.event->>'title' order by e.created_at desc))[1:3] as examples
    from collected_events e, jsonb_array_elements_text(e.event->'tags') t
    where e.event->>'topic' = ${OTHER_TOPIC} and e.created_at > now() - make_interval(days => ${CANDIDATE_DAYS})
      and lower(t) not in (select name from topics union all select jsonb_array_elements_text(tags) from topics)
    group by 1 having count(*) >= ${min_events} order by 2 desc, 1 limit 50`);
  return [...rows];
}
