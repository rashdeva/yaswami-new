// Подписка на темы (CONTEXT.md): раз в сутки бот рассказывает подписчику о новых событиях ленты его города по его Topic.
// Сама подписка меняется операцией users/update-self (services.ts); здесь — только сводка.
import { and, eq, gt, gte, isNull, lt, sql } from 'drizzle-orm';
import type { Db } from './db/client.ts';
import { collectedEvents, subscriptions, users } from './db/schema.ts';
import { notify } from './notifications.ts';
import { collectedSlug } from './services.ts';

/** Не чаще одной сводки за это время: бота, который пишет о каждом событии, выключают. */
const DIGEST_EVERY_MS = 20 * 3600_000;
/** Часы, когда можно писать, по часовому поясу человека. */
const DAY_HOURS = [9, 21] as const;

const hourIn = (timeZone: string, now: Date) => {
  try {
    return Number(new Intl.DateTimeFormat('en', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(now));
  } catch {
    return 12; // пояс не распознан — не молчим из-за этого
  }
};

/** Шаг сводки: отмечает вышедшее в ленту и пишет тем, кому пора и есть о чём. */
export async function digestTopics(db: Db, now = new Date()): Promise<void> {
  // Момент выхода ставим здесь, а не там, где меняется статус: путей в published несколько (очередь, команда).
  await db.update(collectedEvents).set({ published_at: now }).where(and(eq(collectedEvents.status, 'published'), isNull(collectedEvents.published_at)));

  const due = await db
    .select({ user_id: subscriptions.user_id, topics: subscriptions.topics, notified_at: subscriptions.notified_at, timezone: users.timezone, city_id: users.city_id })
    .from(subscriptions).innerJoin(users, eq(users.id, subscriptions.user_id))
    .where(and(sql`jsonb_array_length(${subscriptions.topics}) > 0`, lt(subscriptions.notified_at, new Date(now.getTime() - DIGEST_EVERY_MS))));
  if (!due.length) return;
  // ponytail: все предстоящие события в память и фильтр на каждого подписчика; при тысячах подписчиков — один запрос с join по теме.
  const fresh = await db
    .select({ external_id: collectedEvents.external_id, city_id: collectedEvents.city_id, event: collectedEvents.event, published_at: collectedEvents.published_at })
    .from(collectedEvents)
    .where(and(eq(collectedEvents.status, 'published'), gt(collectedEvents.starts_at, now), gte(collectedEvents.published_at, new Date(Math.min(...due.map((d) => d.notified_at.getTime()))))))
    .orderBy(collectedEvents.starts_at);

  for (const { user_id, topics, notified_at, timezone, city_id } of due) {
    const items = fresh.filter((e) => e.city_id === city_id && e.published_at! > notified_at && topics.includes(e.event.topic ?? ''))
      .map(({ external_id, event: { title, starts_at, topic } }) => ({ id: collectedSlug(external_id), title, starts_at, topic }));
    const hour = hourIn(timezone, now);
    if (!items.length || hour < DAY_HOURS[0] || hour >= DAY_HOURS[1]) continue;
    // Сначала отметка, потом отправка: сбой Telegram не должен приводить к повторной сводке каждые пять минут.
    await db.update(subscriptions).set({ notified_at: now }).where(eq(subscriptions.user_id, user_id));
    await notify(db, user_id, 'topic_digest', { items });
  }
}

/** Раз в пять минут. Один сбой не останавливает цикл. */
export function startSubscriptionsLoop(db: Db, everyMs = 5 * 60_000): void {
  const tick = () => digestTopics(db).catch(console.error);
  setInterval(tick, everyMs);
  void tick();
}
