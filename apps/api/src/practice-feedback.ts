// Отзывы на услуги мастера (Practice без Session; в Luma такого нет). Всё идёт через бота — форм у нас нет.
// У услуги нет даты, и запись на неё — только намерение (practice_signups), поэтому через сутки после записи бот
// спрашивает: «вы были?». Оценка — «был», кнопка «Не дошёл» — «не был»: так мы узнаём, сколько записей дошло до визита.
// Тот, кто у нас не записывался, приходит к боту по ссылке мастера (`t.me/<бот>?start=fb_<мастер>`, `via: invite`).
// После оценки человек пишет отзыв боту, пересылает сообщение с отзывом или присылает на него ссылку — ссылку сверяет
// команда. Отзывы на события — в feedback.ts.
import { and, desc, eq, gt, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import type { AdminHostFeedback, HostFeedbackUpdateInput, HostSelf, HostSelfUpdateInput, Practice, User } from '@yaswami/core';
import { FEEDBACK_COMMENT_MAX, FEEDBACK_PUBLIC_RATING, FEEDBACK_TEXT_MINUTES } from '@yaswami/core';
import { telegramIdOf, userIdByTelegram } from './auth.ts';
import type { Ctx } from './audit.ts';
import { audited } from './audit.ts';
import type { Db } from './db/client.ts';
import { hosts, practiceFeedback, practices, practiceSignups, users } from './db/schema.ts';
import { hostFeedbackUrl } from './feedback.ts';
import { alertTeam } from './inbox.ts';
import { notify, sendCard } from './notifications.ts';
import { AppError, getHost } from './services.ts';
import { settings } from './settings.ts';
import { bot } from './telegram.ts';

const DAY = 86_400_000;
const UUID = /^[0-9a-f-]{36}$/i;
const stars = (rating: number) => '★'.repeat(rating) + '☆'.repeat(5 - rating);
const one = (practiceId: string, userId: number) => and(eq(practiceFeedback.practice_id, practiceId), eq(practiceFeedback.user_id, userId));
/** О скольких услугах человек может начать отзыв по ссылке мастера за сутки: записи у нас за ними нет, это защита от накрутки. */
export const INVITE_FEEDBACK_PER_DAY = 5;
const PRACTICES_ASKED = 8; // сколько услуг мастера предлагаем кнопками на выбор

const bonusLine = (bonus: string | null) => (bonus ? `\n\n🎁 Мастер благодарит за отзыв: ${bonus}. Покажите это сообщение мастеру.` : '');
/** Что бот пишет после оценки: три способа оставить текст и кто его увидит. */
const PROMPT = `Теперь сам отзыв — как удобнее:
• напишите его прямо здесь;
• перешлите сюда своё сообщение с отзывом, если уже писали его в чате или канале;
• или пришлите ссылку на него: в Telegram нажмите на сообщение → «Копировать ссылку», в Instagram — «…» → «Скопировать ссылку». Ссылку мы проверим сами.

Отзыв с оценкой ${FEEDBACK_PUBLIC_RATING}–5 появится на странице мастера, с оценкой ниже — его увидит только мастер. Можно и не отвечать: оценка уже сохранена.`;

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

type AskedHost = { id: string; name: string; feedback_bonus: string | null };

/**
 * Человек сам хочет оставить отзыв об услуге (пришёл по ссылке мастера): заводим вопрос и присылаем карточку с оценками.
 * Записывался у нас — `via: signup`, нет — `invite`. Об этой услуге уже спрашивали — карточка приходит снова: оценку можно сменить.
 * Возвращает текст отказа или null.
 */
async function askAbout(db: Db, userId: number, chatId: number, practice: Pick<Practice, 'id' | 'title'>, host: AskedHost): Promise<string | null> {
  const [existing] = await db.select({ via: practiceFeedback.via }).from(practiceFeedback).where(one(practice.id, userId));
  if (!existing) {
    const [signup] = await db.select({ user_id: practiceSignups.user_id }).from(practiceSignups)
      .where(and(eq(practiceSignups.practice_id, practice.id), eq(practiceSignups.user_id, userId)));
    if (!signup) {
      const [today] = await db.select({ n: sql<number>`count(*)::int` }).from(practiceFeedback)
        .where(and(eq(practiceFeedback.user_id, userId), eq(practiceFeedback.via, 'invite'), gt(practiceFeedback.requested_at, new Date(Date.now() - DAY))));
      if (today!.n >= INVITE_FEEDBACK_PER_DAY) return 'Сегодня вы уже оставили много отзывов. Попробуйте завтра.';
    }
    await db.insert(practiceFeedback).values({ practice_id: practice.id, host_id: host.id, user_id: userId, via: signup ? 'signup' : 'invite' }).onConflictDoNothing();
  }
  // Человек сам пришёл за этим: карточка уходит, даже если вопросы «как прошло» у него выключены.
  await sendCard(chatId, 'feedback_request', { practice, host });
  return null;
}

/**
 * `/start fb_<id мастера>` — ссылка мастера «оставьте отзыв обо мне» (hostFeedbackUrl). Одна услуга — сразу вопрос
 * с оценками, несколько — сначала выбор услуги кнопками. false — параметр не про отзыв.
 */
export async function startHostFeedback(db: Db, actor: User, chatId: number, param: string): Promise<boolean> {
  const m = /^fb_([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})/i.exec(param);
  if (!m) return false;
  const say = (text: string, reply_markup?: object) => bot.send('sendMessage', { chat_id: chatId, text, ...(reply_markup ? { reply_markup } : {}) });
  const host = await getHost(db, m.slice(1).join('-').toLowerCase()).catch(() => null);
  if (!host?.practices.length) return void (await say('Не нашёл услуг этого мастера — возможно, ссылка устарела.')), true;
  const [owner] = await db.select({ user_id: hosts.user_id }).from(hosts).where(eq(hosts.id, host.id));
  if (owner?.user_id === actor.id) return void (await say('Это ссылка для ваших клиентов: отправьте её им — по ней они оставят отзыв о вас.')), true;
  if (host.practices.length === 1) {
    const refused = await askAbout(db, actor.id, chatId, host.practices[0]!, host);
    if (refused) await say(refused);
    return true;
  }
  await say(`О какой услуге отзыв? Мастер: ${host.name}`, {
    inline_keyboard: host.practices.slice(0, PRACTICES_ASKED).map((p) => [{ text: p.title.slice(0, 60), callback_data: `pfa:${p.id}` }]),
  });
  return true;
}

type Callback = { callback_query?: { id: string; from: { id: number }; data?: string } } | null;

/**
 * Нажатие кнопки об услуге: `pfa:<услуга>` — выбрал, о какой услуге отзыв; `pfb:<услуга>:<0–5>` — оценка или 0, «не дошёл».
 * true — это было нажатие об услуге и оно обработано.
 */
export async function handlePracticeFeedbackCallback(db: Db, update: unknown): Promise<boolean> {
  const q = (update as Callback)?.callback_query;
  const picked = /^pfa:([0-9a-f-]{36})$/.exec(q?.data ?? '');
  const m = /^pfb:([0-9a-f-]{36}):([0-5])$/.exec(q?.data ?? '');
  if (!q || (!picked && !m)) return false;
  // Кнопку нажал человек в Telegram: его пользователя ищем по способу входа (ADR-0008).
  const userId = await userIdByTelegram(db, q.from.id);
  const answer = (text?: string) => void bot.call('answerCallbackQuery', { callback_query_id: q.id, ...(text ? { text } : {}) });

  if (picked) {
    const [found] = userId === null ? [] : await db.select({ practice: { id: practices.id, title: practices.title }, host: hosts })
      .from(practices).innerJoin(hosts, eq(hosts.id, practices.host_id))
      .where(and(eq(practices.id, picked[1]!), eq(practices.status, 'published'), ne(hosts.status, 'rejected')));
    if (!found || found.host.user_id === userId) return answer('Эта услуга больше не доступна'), true;
    answer(await askAbout(db, userId!, q.from.id, found.practice, found.host) ?? undefined);
    return true;
  }

  const rating = Number(m![2]) || null;
  const [row] = userId === null ? [] : await db.update(practiceFeedback)
    // «Не дошёл» после оценки стирает и отзыв: о визите, которого не было, показывать нечего.
    .set({ attended: rating !== null, rating, ...(rating === null ? { comment: null, source_url: null, verified_at: null } : {}), updated_at: new Date(), host_notified_at: null })
    .where(one(m![1]!, userId)).returning();
  answer(!row ? 'Этот запрос уже не действует' : rating ? `Спасибо! Ваша оценка: ${stars(rating)}` : 'Понятно, спасибо за ответ!');
  // Просим текст один раз: повторные нажатия меняют оценку, но не засыпают сообщениями.
  if (row?.rating && !row.prompt_message_id) {
    const [host] = await db.select({ feedback_bonus: hosts.feedback_bonus }).from(hosts).where(eq(hosts.id, row.host_id));
    const sent = await bot.send('sendMessage', {
      chat_id: q.from.id, text: PROMPT + bonusLine(host?.feedback_bonus ?? null),
      reply_markup: { force_reply: true, input_field_placeholder: 'Ваш отзыв' },
    });
    const promptId = (sent.result as { message_id?: number } | undefined)?.message_id;
    if (promptId) await db.update(practiceFeedback).set({ prompt_message_id: promptId }).where(one(row.practice_id, row.user_id));
  }
  return true;
}

// Ссылка на сообщение, где человек уже написал отзыв: Telegram или Instagram. Прочитать её сами мы не можем.
const LINK = /(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|instagram\.com)\/[^\s]+/i;

/** Сообщение человека боту, которое может оказаться отзывом. `forwarded` — пересланное: `channel` — публикация канала, у неё есть адрес. */
interface Said {
  text: string;
  replyTo: number | null;
  forwarded: { channel?: { username?: string; number: number } } | null;
}

/**
 * Текст отзыва на услугу. Им считается ответ на вопрос бота «теперь сам отзыв…», а первые FEEDBACK_TEXT_MINUTES минут
 * после оценки — и просто следующее сообщение: написанное, пересланное или со ссылкой.
 * `saved` — текст сохранён; `link` — человек прислал ссылку на сообщение: её сверит команда, до того отзыв не показываем;
 * null — это сообщение не про отзыв на услугу.
 */
export async function takePracticeFeedbackText(db: Db, actor: User, { text, replyTo, forwarded }: Said): Promise<'saved' | 'link' | null> {
  if (!text) return null;
  const [row] = await db.select().from(practiceFeedback)
    .where(and(eq(practiceFeedback.user_id, actor.id), isNotNull(practiceFeedback.rating), replyTo !== null
      ? eq(practiceFeedback.prompt_message_id, replyTo)
      : and(isNotNull(practiceFeedback.prompt_message_id), isNull(practiceFeedback.comment), isNull(practiceFeedback.source_url),
        gt(practiceFeedback.updated_at, new Date(Date.now() - FEEDBACK_TEXT_MINUTES * 60_000)))))
    .orderBy(desc(practiceFeedback.updated_at)).limit(1);
  if (!row) return null;
  // Пересланное из канала — подлинное: адрес публикации знает сам Telegram, сверять нечего.
  const post = forwarded?.channel?.username ? `https://t.me/${forwarded.channel.username}/${forwarded.channel.number}` : null;
  const link = forwarded ? null : LINK.exec(text)?.[0].replace(/^(?!https?:\/\/)/i, 'https://') ?? null;
  const comment = (link ? text.replace(LINK, '') : text).trim().slice(0, FEEDBACK_COMMENT_MAX) || null;
  await db.update(practiceFeedback)
    .set({ comment, source_url: post ?? link, verified_at: post ? new Date() : null, updated_at: new Date(), host_notified_at: null })
    .where(one(row.practice_id, row.user_id));
  if (!link) return 'saved';
  const who = `${actor.first_name}${actor.username ? ` (@${actor.username})` : ''}`;
  await alertTeam(`${who} прислал отзыв о мастере ссылкой — сверьте: ${link}\n${settings.publicUrl}/hosts/${row.host_id}`, await telegramIdOf(db, actor.id)).catch(console.error);
  return 'link';
}

/** Профиль организатора, который человек подтвердил входом. */
async function ownHost(db: Db, actor: User) {
  const [host] = await db.select().from(hosts).where(eq(hosts.user_id, actor.id));
  if (!host) throw new AppError('not_host', 403);
  return host;
}

const toHostSelf = (h: { id: string; feedback_bonus: string | null }): HostSelf => ({ host_id: h.id, feedback_bonus: h.feedback_bonus, feedback_url: hostFeedbackUrl(h.id) });

/** Свой профиль организатора: что обещано за отзыв и ссылка, по которой клиенты оставляют отзыв в боте. */
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
      // Отзыв ссылкой без текста: мастеру — сама ссылка, он её откроет.
      fresh: rows.map((r) => ({ first_name: r.first_name, rating: r.feedback.rating!, comment: r.feedback.comment ?? r.feedback.source_url })),
    });
  }
}

// --- Команда

const adminRows = (db: Pick<Db, 'select'>) => db
  .select({ f: practiceFeedback, practice_title: practices.title, user_first_name: users.first_name, user_username: users.username })
  .from(practiceFeedback).innerJoin(users, eq(users.id, practiceFeedback.user_id)).innerJoin(practices, eq(practices.id, practiceFeedback.practice_id));
const toAdmin = ({ f, ...names }: Awaited<ReturnType<typeof adminRows>>[number]): AdminHostFeedback => ({
  host_id: f.host_id, practice_id: f.practice_id, user_id: f.user_id, ...names, via: f.via, attended: f.attended, rating: f.rating, comment: f.comment,
  source_url: f.source_url, verified_at: f.verified_at, requested_at: f.requested_at, updated_at: f.updated_at,
});

/** Отзывы на услуги организатора глазами команды: все, и без ответа тоже; свежие сверху. */
export async function listHostFeedback(db: Db, hostId: string): Promise<AdminHostFeedback[]> {
  if (!UUID.test(hostId) || !(await db.select({ id: hosts.id }).from(hosts).where(eq(hosts.id, hostId))).length) throw new AppError('not_found', 404);
  return (await adminRows(db).where(eq(practiceFeedback.host_id, hostId)).orderBy(desc(practiceFeedback.updated_at))).map(toAdmin);
}

/**
 * Решение команды по отзыву, присланному ссылкой: сверили (`verified`) и, если нужно, переписали его текст (`comment`).
 * В журнале — правка организатора: его снимок включает отзывы.
 */
export const updateHostFeedback = async (db: Db, ctx: Ctx, hostId: string, practiceId: string, userId: number, input: HostFeedbackUpdateInput): Promise<AdminHostFeedback> => {
  if (!UUID.test(hostId) || !UUID.test(practiceId)) throw new AppError('not_found', 404);
  return audited(db, ctx, { action: 'admin_hosts_feedback_update', entity: 'host', id: hostId, input: { practice_id: practiceId, user_id: userId, ...input } }, async (tx) => {
    const where = and(eq(practiceFeedback.host_id, hostId), one(practiceId, userId));
    const { verified, comment } = input;
    // updated_at не трогаем: это время отзыва гостя, по нему отзывы стоят на странице мастера.
    const values = { ...(verified !== undefined ? { verified_at: verified ? new Date() : null } : {}), ...(comment !== undefined ? { comment: comment || null } : {}) };
    if (Object.keys(values).length) await tx.update(practiceFeedback).set(values).where(where);
    const [row] = await adminRows(tx).where(where);
    if (!row) throw new AppError('not_found', 404);
    return toAdmin(row);
  });
};

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
