// Отзывы на услуги мастера (Practice без Session; в Luma такого нет). У услуги нет даты, и запись на неё — только
// намерение (practice_signups), поэтому через сутки после записи бот спрашивает: «вы были?». Оценка — «был»,
// кнопка «Не дошёл» — «не был»: так мы узнаём, сколько записей дошло до визита. Тот, кто у нас не записывался,
// оставляет отзыв сам по ссылке мастера (`via: invite`). Отзывы на события — в feedback.ts.
import { and, desc, eq, gt, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import type { AdminHostFeedback, HostFeedbackCreated, HostFeedbackCreateInput, HostSelf, HostSelfUpdateInput, User } from '@yaswami/core';
import { FEEDBACK_COMMENT_MAX, FEEDBACK_PUBLIC_RATING } from '@yaswami/core';
import { userIdByTelegram } from './auth.ts';
import type { Ctx } from './audit.ts';
import { audited } from './audit.ts';
import type { Db } from './db/client.ts';
import { hosts, practiceFeedback, practices, practiceSignups, users } from './db/schema.ts';
import { notify } from './notifications.ts';
import { AppError, getHost } from './services.ts';
import { settings } from './settings.ts';
import { bot } from './telegram.ts';

const DAY = 86_400_000;
const stars = (rating: number) => '★'.repeat(rating) + '☆'.repeat(5 - rating);
const one = (practiceId: string, userId: number) => and(eq(practiceFeedback.practice_id, practiceId), eq(practiceFeedback.user_id, userId));
/** Сколько отзывов по ссылке мастера человек может оставить за сутки: записи у нас за ними нет, это защита от накрутки. */
export const INVITE_FEEDBACK_PER_DAY = 5;

/** Ссылка «оставьте отзыв обо мне»: страница мастера с открытой формой отзыва. */
export const hostFeedbackUrl = (hostId: string) => `${settings.publicUrl}/hosts/${hostId}?feedback=1`;

const bonusLine = (bonus: string | null) => (bonus ? `\n\n🎁 Мастер благодарит за отзыв: ${bonus}. Покажите это сообщение мастеру.` : '');

/**
 * Спрашивает «вы были?» у тех, кто записался на услугу сутки назад (от суток до двух: первый запуск не должен
 * разослать вопросы по всей истории записей). Строка в practice_feedback появляется вместе с вопросом — второй раз не спросим.
 */
export async function requestPracticeFeedback(db: Db, now = new Date()): Promise<void> {
  const rows = await db
    .select({ practice: { id: practices.id, title: practices.title }, host: hosts, user_id: practiceSignups.user_id })
    .from(practiceSignups)
    .innerJoin(practices, eq(practices.id, practiceSignups.practice_id))
    .innerJoin(hosts, eq(hosts.id, practices.host_id))
    .leftJoin(practiceFeedback, and(eq(practiceFeedback.practice_id, practiceSignups.practice_id), eq(practiceFeedback.user_id, practiceSignups.user_id)))
    .where(and(
      eq(practices.status, 'published'), ne(hosts.status, 'rejected'), isNull(practiceFeedback.user_id),
      sql`${practiceSignups.created_at} between ${new Date(now.getTime() - 2 * DAY).toISOString()}::timestamptz and ${new Date(now.getTime() - DAY).toISOString()}::timestamptz`,
    ));
  for (const { practice, host, user_id } of rows) {
    if (user_id === host.user_id) continue; // мастер сам себе отзыв не пишет
    const [created] = await db.insert(practiceFeedback).values({ practice_id: practice.id, host_id: host.id, user_id, via: 'signup' }).onConflictDoNothing().returning();
    if (created) await notify(db, user_id, 'feedback_request', { practice, host });
  }
}

/** Нажатие кнопки под вопросом об услуге: оценка 1–5 или 0 — «не дошёл». true — это был ответ об услуге и он обработан. */
export async function handlePracticeFeedbackCallback(db: Db, update: unknown): Promise<boolean> {
  const q = (update as { callback_query?: { id: string; from: { id: number }; data?: string } } | null)?.callback_query;
  const m = /^pfb:([0-9a-f-]{36}):([0-5])$/.exec(q?.data ?? '');
  if (!q || !m) return false;
  const rating = Number(m[2]) || null;
  // Кнопку нажал человек в Telegram: его пользователя ищем по способу входа (ADR-0008).
  const userId = await userIdByTelegram(db, q.from.id);
  const [row] = userId === null ? [] : await db.update(practiceFeedback)
    // «Не дошёл» после оценки стирает и её текст: отзыв о визите, которого не было, показывать нечего.
    .set({ attended: rating !== null, rating, ...(rating === null ? { comment: null } : {}), updated_at: new Date(), host_notified_at: null })
    .where(one(m[1]!, userId)).returning();
  void bot.call('answerCallbackQuery', {
    callback_query_id: q.id,
    text: !row ? 'Этот запрос уже не действует' : rating ? `Спасибо! Ваша оценка: ${stars(rating)}` : 'Понятно, спасибо за ответ!',
  });
  // Просим текст один раз: повторные нажатия меняют оценку, но не засыпают сообщениями.
  if (row?.rating && !row.prompt_message_id) {
    const [host] = await db.select({ feedback_bonus: hosts.feedback_bonus }).from(hosts).where(eq(hosts.id, row.host_id));
    const sent = await bot.send('sendMessage', {
      chat_id: q.from.id,
      // Правило видимости — в самом вопросе: оценку можно сменить и после него, а текст покажем по итоговой.
      text: `Напишите пару слов — ответьте на это сообщение. Отзыв с оценкой ${FEEDBACK_PUBLIC_RATING}–5 появится на странице мастера, с оценкой ниже — его увидит только мастер. Можно и не отвечать: оценка уже сохранена.${bonusLine(host?.feedback_bonus ?? null)}`,
      reply_markup: { force_reply: true, input_field_placeholder: 'Ваш отзыв' },
    });
    const promptId = (sent.result as { message_id?: number } | undefined)?.message_id;
    if (promptId) await db.update(practiceFeedback).set({ prompt_message_id: promptId }).where(one(row.practice_id, row.user_id));
  }
  return true;
}

/** Текст отзыва: ответ на сообщение «пара слов…». false — сообщение, на которое ответили, не про отзыв на услугу. */
export async function savePracticeFeedbackComment(db: Db, userId: number, repliedTo: number, text: string): Promise<boolean> {
  const saved = await db.update(practiceFeedback)
    .set({ comment: text.slice(0, FEEDBACK_COMMENT_MAX), updated_at: new Date(), host_notified_at: null })
    .where(and(eq(practiceFeedback.user_id, userId), eq(practiceFeedback.prompt_message_id, repliedTo), isNotNull(practiceFeedback.rating)))
    .returning({ practice_id: practiceFeedback.practice_id });
  return saved.length > 0;
}

/**
 * Отзыв на услугу от самого человека — из приложения или по ссылке мастера. Записывался у нас — `via: signup`,
 * нет — `invite`. Повторный отзыв заменяет прежний; откуда он, остаётся как было.
 */
export async function createHostFeedback(db: Db, actor: User, hostId: string, input: HostFeedbackCreateInput): Promise<HostFeedbackCreated> {
  const host = await getHost(db, hostId);
  const practice = host.practices.find((p) => p.id === input.practice_id); // только то, что видно в каталоге
  if (!practice) throw new AppError('not_found', 404);
  const [owner] = await db.select({ user_id: hosts.user_id }).from(hosts).where(eq(hosts.id, host.id));
  if (owner?.user_id === actor.id) throw new AppError('own_host', 403);
  const [existing] = await db.select({ via: practiceFeedback.via }).from(practiceFeedback).where(one(practice.id, actor.id));
  const [signup] = await db.select({ user_id: practiceSignups.user_id }).from(practiceSignups)
    .where(and(eq(practiceSignups.practice_id, practice.id), eq(practiceSignups.user_id, actor.id)));
  const via = existing?.via ?? (signup ? 'signup' : 'invite');
  if (!existing && via === 'invite') {
    const [today] = await db.select({ n: sql<number>`count(*)::int` }).from(practiceFeedback)
      .where(and(eq(practiceFeedback.user_id, actor.id), eq(practiceFeedback.via, 'invite'), gt(practiceFeedback.requested_at, new Date(Date.now() - DAY))));
    if (today!.n >= INVITE_FEEDBACK_PER_DAY) throw new AppError('feedback_limit', 429);
  }
  const fields = { attended: true, rating: input.rating, ...(input.comment !== undefined ? { comment: input.comment || null } : {}), updated_at: new Date(), host_notified_at: null };
  const [row] = await db.insert(practiceFeedback).values({ practice_id: practice.id, host_id: host.id, user_id: actor.id, via, ...fields })
    .onConflictDoUpdate({ target: [practiceFeedback.practice_id, practiceFeedback.user_id], set: fields }).returning();
  return { practice_id: practice.id, rating: row!.rating!, comment: row!.comment, via: row!.via, feedback_bonus: host.feedback_bonus };
}

/** Профиль организатора, который человек подтвердил входом. */
async function ownHost(db: Db, actor: User) {
  const [host] = await db.select().from(hosts).where(eq(hosts.user_id, actor.id));
  if (!host) throw new AppError('not_host', 403);
  return host;
}

const toHostSelf = (h: { id: string; feedback_bonus: string | null }): HostSelf => ({ host_id: h.id, feedback_bonus: h.feedback_bonus, feedback_url: hostFeedbackUrl(h.id) });

/** Свой профиль организатора: что обещано за отзыв и ссылка, по которой клиенты оставляют отзыв. */
export const getHostSelf = async (db: Db, actor: User): Promise<HostSelf> => toHostSelf(await ownHost(db, actor));

/** Мастер правит свой профиль: что он даёт гостю за отзыв. Обещание исполняет он сам — мы его только показываем. */
export async function updateHostSelf(db: Db, actor: User, input: HostSelfUpdateInput): Promise<HostSelf> {
  const host = await ownHost(db, actor);
  const [saved] = await db.update(hosts).set({ feedback_bonus: input.feedback_bonus }).where(eq(hosts.id, host.id)).returning();
  return toHostSelf(saved!);
}

/**
 * Сводка мастеру: новые и изменённые отзывы на его услуги одним сообщением, когда `feedbackSettleMs` по ним тихо.
 * Мастеру, который не вошёл в Ясвами, писать некуда: отметка ставится, отзывы ждут его на странице.
 */
export async function digestPracticeFeedback(db: Db, now = new Date()): Promise<void> {
  const fresh = await db
    .select({ feedback: practiceFeedback, first_name: users.first_name })
    .from(practiceFeedback).innerJoin(users, eq(users.id, practiceFeedback.user_id))
    .where(and(isNotNull(practiceFeedback.rating), isNull(practiceFeedback.host_notified_at)))
    .orderBy(practiceFeedback.updated_at);
  for (const [hostId, rows] of Map.groupBy(fresh, (r) => r.feedback.host_id)) {
    if (rows.some((r) => now.getTime() - r.feedback.updated_at.getTime() < settings.feedbackSettleMs)) continue;
    const [host] = await db.select({ id: hosts.id, user_id: hosts.user_id }).from(hosts).where(eq(hosts.id, hostId));
    const [total] = await db
      .select({ count: sql<number>`count(*)::int`, average: sql<number>`avg(${practiceFeedback.rating})::float` })
      .from(practiceFeedback).where(and(eq(practiceFeedback.host_id, hostId), isNotNull(practiceFeedback.rating)));
    // Сначала отметка, потом отправка: сбой Telegram не должен приводить к повторным сводкам каждые пять минут.
    await db.update(practiceFeedback).set({ host_notified_at: now })
      .where(and(eq(practiceFeedback.host_id, hostId), isNull(practiceFeedback.host_notified_at), isNotNull(practiceFeedback.rating)));
    if (host?.user_id == null) continue;
    await notify(db, host.user_id, 'feedback_received', {
      host: { id: host.id }, count: total!.count, average: total!.average,
      fresh: rows.map((r) => ({ first_name: r.first_name, rating: r.feedback.rating!, comment: r.feedback.comment })),
    });
  }
}

// --- Команда

/** Отзывы на услуги организатора глазами команды: все, и без ответа тоже; свежие сверху. */
export async function listHostFeedback(db: Db, hostId: string): Promise<AdminHostFeedback[]> {
  if (!/^[0-9a-f-]{36}$/i.test(hostId) || !(await db.select({ id: hosts.id }).from(hosts).where(eq(hosts.id, hostId))).length) throw new AppError('not_found', 404);
  const rows = await db
    .select({ f: practiceFeedback, practice_title: practices.title, user_first_name: users.first_name, user_username: users.username })
    .from(practiceFeedback).innerJoin(users, eq(users.id, practiceFeedback.user_id)).innerJoin(practices, eq(practices.id, practiceFeedback.practice_id))
    .where(eq(practiceFeedback.host_id, hostId)).orderBy(desc(practiceFeedback.updated_at));
  return rows.map(({ f, ...names }) => ({
    host_id: f.host_id, practice_id: f.practice_id, user_id: f.user_id, ...names,
    via: f.via, attended: f.attended, rating: f.rating, comment: f.comment, requested_at: f.requested_at, updated_at: f.updated_at,
  }));
}

/** Удалить один отзыв на услугу (например, с оскорблениями). В журнале — правка организатора: его снимок включает отзывы. */
export const deleteHostFeedback = (db: Db, ctx: Ctx, hostId: string, practiceId: string, userId: number): Promise<void> =>
  audited(db, ctx, { action: 'admin_hosts_feedback_delete', entity: 'host', id: hostId, input: { practice_id: practiceId, user_id: userId } }, async (tx) => {
    const gone = await tx.delete(practiceFeedback).where(and(eq(practiceFeedback.host_id, hostId), one(practiceId, userId))).returning({ user_id: practiceFeedback.user_id });
    if (!gone.length) throw new AppError('not_found', 404);
  });

/** Раз в пять минут: вопросы «вы были?» и сводки мастерам. Один сбой не останавливает цикл. */
export function startPracticeFeedbackLoop(db: Db, everyMs = 5 * 60_000): void {
  const tick = () => requestPracticeFeedback(db).then(() => digestPracticeFeedback(db)).catch(console.error);
  setInterval(tick, everyMs);
  void tick();
}
