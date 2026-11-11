// Отзывы о прошедшем событии. Гостю, который был записан, бот после события присылает карточку с оценкой
// от 1 до 5 (кнопки под сообщением). После оценки просит пару слов — ответ на это сообщение становится текстом
// отзыва: полей ввода в виджетах Telegram нет. Организатору отзывы приходят сводкой, а не по одному.
// Всё состояние — в таблице event_feedback, поэтому перезапуск сервера ничего не теряет.
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Db } from './db/client.ts';
import { eventFeedback, events, guests, users } from './db/schema.ts';
import { notify } from './notifications.ts';
import { settings } from './settings.ts';
import { bot } from './telegram.ts';

export const COMMENT_MAX = 1000;
const DAY = 86_400_000;
const stars = (rating: number) => '★'.repeat(rating) + '☆'.repeat(5 - rating);

// Событие закончилось: по времени окончания, а без него — через три часа после начала (как на витрине).
const endedAt = sql`coalesce(${events.end_at}, ${events.start_at} + interval '3 hours')`;

/**
 * Просит отзыв у гостей событий, закончившихся за последние сутки. Строка в event_feedback появляется вместе
 * с запросом, так что второй раз человека не спросят. События старше суток не трогаем: первый запуск
 * не должен разослать запросы по всей истории.
 */
export async function requestFeedback(db: Db, now = new Date()): Promise<void> {
  const rows = await db
    .select({ event: events, user_id: guests.user_id })
    .from(guests)
    .innerJoin(events, eq(events.id, guests.event_id))
    .leftJoin(eventFeedback, and(eq(eventFeedback.event_id, guests.event_id), eq(eventFeedback.user_id, guests.user_id)))
    .where(and(
      eq(guests.approval_status, 'approved'), eq(events.status, 'published'), isNull(eventFeedback.user_id),
      sql`${endedAt} between ${new Date(now.getTime() - DAY).toISOString()}::timestamptz and ${now.toISOString()}::timestamptz`,
    ));
  for (const { event, user_id } of rows) {
    if (user_id === event.user_id) continue; // организатор сам себе отзыв не пишет
    const [created] = await db.insert(eventFeedback).values({ event_id: event.id, user_id }).onConflictDoNothing().returning();
    if (created) await notify(user_id, 'feedback_request', { event });
  }
}

/** Оценка по кнопке под карточкой. false — этого человека об этом событии не спрашивали. */
async function rate(db: Db, userId: number, eventId: string, rating: number) {
  const [row] = await db
    .update(eventFeedback)
    .set({ rating, updated_at: new Date(), host_notified_at: null })
    .where(and(eq(eventFeedback.event_id, eventId), eq(eventFeedback.user_id, userId)))
    .returning();
  return row;
}

/** Нажатие кнопки под сообщением бота. true — это была оценка события и она обработана. */
export async function handleFeedbackCallback(db: Db, update: unknown): Promise<boolean> {
  const q = (update as { callback_query?: { id: string; from: { id: number }; data?: string } } | null)?.callback_query;
  const m = /^fb:([\w-]+):([1-5])$/.exec(q?.data ?? '');
  if (!q || !m) return false;
  const row = await rate(db, q.from.id, m[1]!, Number(m[2]));
  void bot.call('answerCallbackQuery', { callback_query_id: q.id, text: row ? `Спасибо! Ваша оценка: ${stars(row.rating!)}` : 'Этот запрос уже не действует' });
  // Просим текст один раз: повторные нажатия меняют оценку, но не засыпают сообщениями.
  if (row && !row.prompt_message_id) {
    const sent = await bot.send('sendMessage', {
      chat_id: q.from.id,
      text: 'Что понравилось и что стоит улучшить? Ответьте на это сообщение — передам организатору. Можно и не отвечать: оценка уже сохранена.',
      reply_markup: { force_reply: true, input_field_placeholder: 'Ваш отзыв' },
    });
    const promptId = (sent.result as { message_id?: number } | undefined)?.message_id;
    if (promptId) await db.update(eventFeedback).set({ prompt_message_id: promptId }).where(and(eq(eventFeedback.event_id, row.event_id), eq(eventFeedback.user_id, row.user_id)));
  }
  return true;
}

/** Текст отзыва: ответ на сообщение «что понравилось…». false — сообщение, на которое ответили, не про отзыв. */
export async function saveFeedbackComment(db: Db, userId: number, repliedTo: number, text: string): Promise<boolean> {
  const saved = await db
    .update(eventFeedback)
    .set({ comment: text.slice(0, COMMENT_MAX), updated_at: new Date(), host_notified_at: null })
    .where(and(eq(eventFeedback.user_id, userId), eq(eventFeedback.prompt_message_id, repliedTo), isNotNull(eventFeedback.rating)))
    .returning({ event_id: eventFeedback.event_id });
  return saved.length > 0;
}

/**
 * Сводка организатору: новые и изменённые отзывы по событию одним сообщением. Ждём, пока по событию
 * `feedbackSettleMs` не будет новых отзывов: гость успевает дописать текст, а поток оценок не становится потоком сообщений.
 */
export async function digestFeedback(db: Db, now = new Date()): Promise<void> {
  const fresh = await db
    .select({ feedback: eventFeedback, first_name: users.first_name })
    .from(eventFeedback)
    .innerJoin(users, eq(users.id, eventFeedback.user_id))
    .where(and(isNotNull(eventFeedback.rating), isNull(eventFeedback.host_notified_at)))
    .orderBy(eventFeedback.updated_at);
  const byEvent = Map.groupBy(fresh, (r) => r.feedback.event_id);
  for (const [eventId, rows] of byEvent) {
    if (rows.some((r) => now.getTime() - r.feedback.updated_at.getTime() < settings.feedbackSettleMs)) continue;
    const [event] = await db.select().from(events).where(eq(events.id, eventId));
    const [total] = await db
      .select({ count: sql<number>`count(*)::int`, average: sql<number>`avg(${eventFeedback.rating})::float` })
      .from(eventFeedback)
      .where(and(eq(eventFeedback.event_id, eventId), isNotNull(eventFeedback.rating)));
    // Сначала отметка, потом отправка: сбой Telegram не должен приводить к повторным сводкам каждые пять минут.
    await db.update(eventFeedback).set({ host_notified_at: now })
      .where(and(eq(eventFeedback.event_id, eventId), isNull(eventFeedback.host_notified_at), isNotNull(eventFeedback.rating)));
    await notify(event!.user_id, 'feedback_received', {
      event: event!, count: total!.count, average: total!.average,
      fresh: rows.map((r) => ({ first_name: r.first_name, rating: r.feedback.rating!, comment: r.feedback.comment })),
    });
  }
}

/** Отзывы события для его страницы: средняя оценка — всем, сами отзывы — только организатору. */
export async function eventFeedbackView(db: Db, eventId: string, forHost: boolean) {
  const rows = await db
    .select({ user_first_name: users.first_name, rating: eventFeedback.rating, comment: eventFeedback.comment })
    .from(eventFeedback)
    .innerJoin(users, eq(users.id, eventFeedback.user_id))
    .where(and(eq(eventFeedback.event_id, eventId), isNotNull(eventFeedback.rating)))
    .orderBy(eventFeedback.updated_at);
  return {
    count: rows.length,
    average: rows.length ? rows.reduce((n, r) => n + r.rating!, 0) / rows.length : null,
    items: forHost ? rows.map((r) => ({ ...r, rating: r.rating! })) : [],
  };
}

/** Раз в пять минут: запросы отзывов и сводки организаторам. Один сбой не останавливает цикл. */
export function startFeedbackLoop(db: Db, everyMs = 5 * 60_000): void {
  const tick = () => requestFeedback(db).then(() => digestFeedback(db)).catch(console.error);
  setInterval(tick, everyMs);
  void tick();
}
