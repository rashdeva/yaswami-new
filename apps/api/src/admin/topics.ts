// Темы (Topic): список правят команда и агенты — через журнал. Сборщик добавляет темы сам (store.mjs).
import { asc, eq, sql } from 'drizzle-orm';
import type { AdminTopic, TopicCandidate, TopicCandidateListInput, TopicCreateInput, TopicUpdateInput } from '@yaswami/core';
import { hasBuiltInIcon, OTHER_TOPIC, TOPIC_SPLIT_MIN } from '@yaswami/core';
import type { Ctx } from '../audit.ts';
import { audited } from '../audit.ts';
import type { Db, Tx } from '../db/client.ts';
import { subscriptions, topics } from '../db/schema.ts';
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
 * События без темы («другое») с меткой темы переходят в неё; если тема выделена из широкой (`from`) — и события той
 * с этими метками. У услуг меток нет — их тему правит команда.
 * ponytail: в снимок журнала эти события не входят — отмена создания темы оставит им её имя, и они покажутся
 * как «другое»; вернуть — правкой события.
 */
const retag = (tx: Db | Tx, name: string, tags: string[], from?: string) => (tags.length
  ? tx.execute(sql`update collected_events set event = jsonb_set(event, '{topic}', to_jsonb(${name}::text))
      where event->>'topic' in ${[OTHER_TOPIC, ...(from ? [from] : [])]} and exists (select 1 from jsonb_array_elements_text(event->'tags') t where lower(t) in ${tags})`)
  : null);

/** Подписанные на широкую тему получают и выделенную из неё: иначе они молча перестали бы слышать о части событий. */
const followSplit = (tx: Db | Tx, name: string, from: string) => tx.update(subscriptions)
  .set({ topics: sql`${subscriptions.topics} || to_jsonb(${name}::text)` })
  .where(sql`${subscriptions.topics} ? ${from} and not ${subscriptions.topics} ? ${name}`);

/** Новая тема: сразу видна людям и сборщику; иконку нарисует иллюстратор на следующем шаге очереди. */
export async function createTopic(db: Db, ctx: Ctx, { split_from, ...input }: TopicCreateInput): Promise<AdminTopic> {
  const created = await audited<AdminTopic>(db, ctx, { action: 'admin_topics_create', entity: 'topic', id: (r) => r.name, input: { ...input, split_from } }, async (tx) => {
    if (split_from && !(await tx.select({ name: topics.name }).from(topics).where(eq(topics.name, split_from))).length) throw new AppError('topic_not_found', 404);
    const added = await tx.insert(topics)
      .values({ ...input, color: input.color.toLowerCase(), origin: 'team', position: sql`(select coalesce(max(position), 0) + 1 from topics)` })
      .onConflictDoNothing().returning({ name: topics.name });
    if (!added.length) throw new AppError('topic_exists', 409); // занято имя или slug
    await retag(tx, input.name, input.tags, split_from);
    if (split_from) await followSplit(tx, input.name, split_from);
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
 * Кандидаты в темы за последние CANDIDATE_DAYS дней, кроме меток существующих тем: Tag событий без темы (от `min_events`
 * событий) и Tag, ставший заметным внутри существующей темы (от TOPIC_SPLIT_MIN). Считаются и отклонённые события:
 * тему могли не публиковать именно потому, что её не было. Тот же запрос — у сборщика (store.mjs).
 */
export async function listTopicCandidates(db: Db, { min_events }: TopicCandidateListInput): Promise<TopicCandidate[]> {
  const rows = await db.execute<TopicCandidate & Record<string, unknown>>(sql`
    with recent as (
      select event, created_at, event->>'topic' as topic, coalesce(telegram_username, channel) as host
      from collected_events where event ? 'topic' and created_at > now() - make_interval(days => ${CANDIDATE_DAYS})
    ), totals as (select topic, count(*)::int as n from recent group by 1)
    select lower(t) as tag, nullif(r.topic, ${OTHER_TOPIC}) as inside, max(totals.n) as inside_events_count,
      count(*)::int as events_count, count(distinct r.host)::int as hosts_count,
      (array_agg(r.event->>'title' order by r.created_at desc))[1:3] as examples
    from recent r join totals using (topic), jsonb_array_elements_text(r.event->'tags') t
    where lower(t) not in (select name from topics union all select jsonb_array_elements_text(tags) from topics)
    group by 1, r.topic
    having case when r.topic = ${OTHER_TOPIC} then count(*) >= ${min_events}
      else count(*) >= ${TOPIC_SPLIT_MIN.events} and count(distinct r.host) >= ${TOPIC_SPLIT_MIN.hosts} end
    order by 4 desc, 1 limit 50`);
  return [...rows];
}
