// Сообщение боту → событие. Человек пишет анонс или пересылает публикацию; бот разбирает её тем же механизмом,
// что и сборщик каналов (@yaswami/extract), и отвечает виджетом. Свой анонс становится событием отправителя,
// пересланный чужой — собранным событием на витрине, без хозяина.
import type { CollectedEvent, User } from '@yaswami/core';
import { collectedWhen } from '@yaswami/core';
import type { Announcement } from '@yaswami/extract';
import { looksLikeEvent } from '@yaswami/extract';
import { upsertUser } from './auth.ts';
import type { Db } from './db/client.ts';
import { handleFeedbackCallback, saveFeedbackComment } from './feedback.ts';
import { alertAdmins, recordIncoming, setAttention, supportHistory } from './inbox.ts';
import { writing } from './live.ts';
import { collectedUrl, notify } from './notifications.ts';
import { addCollectedEvent, AppError, createEventFromAnnouncement, getCollectedEvent, getEvent, listEvents, myCollectedEvents } from './services.ts';
import { settings } from './settings.ts';
import { issueTicket, support } from './support.ts';
import type { SupportTurn } from './support.ts';
import type { Incoming } from './telegram.ts';
import { bot, parseIncoming } from './telegram.ts';

export type Extract = (announcement: Announcement) => Promise<CollectedEvent[]>;

export const REPLIES = {
  help: 'Пришлите анонс события текстом или перешлите публикацию — я создам событие: что, когда и где. Запись гостей и список — в приложении.',
  no_date: 'Не вижу здесь события: нет даты или сообщение слишком короткое. Пришлите анонс целиком — что будет, когда и где.',
  not_event: 'Это не похоже на анонс события с датой. Пришлите анонс целиком — что будет, когда и где.',
  past: 'Похоже, это событие уже прошло. Пришлите анонс предстоящего события.',
  too_often: 'Слишком много сообщений подряд. Подождите минуту и пришлите анонс ещё раз.',
  unavailable: 'Сейчас не получилось разобрать сообщение. Попробуйте ещё раз через минуту.',
  not_host: 'Создавать события пока могут только организаторы. Если вы проводите события — напишите об этом сюда, мы откроем вам создание.',
  limit: (left: number) =>
    `Бесплатно можно создать ${settings.freeEventsLimit} событий, лимит исчерпан.${left > 1 ? ` Не добавлено событий: ${left}.` : ''}`,
};

/** Источник пересланного анонса. У публикации канала ключ и адрес те же, что даёт ей сборщик: дубля не будет. */
function sourceOf(m: Incoming) {
  const c = m.origin?.channel;
  if (c?.username) return { channel: c.username.toLowerCase(), number: c.number, url: `https://t.me/${c.username}/${c.number}` };
  if (c) return { channel: String(c.id), number: c.number, url: `https://t.me/c/${String(c.id).replace(/^-100/, '')}/${c.number}` };
  // Переслано от человека или из группы: адреса у публикации нет, источником указываем автора.
  return { channel: `bot${m.chatId}`, number: m.messageId, url: m.origin?.username ? `https://t.me/${m.origin.username}` : settings.publicUrl };
}

// Разбор стоит запроса к ИИ, а их немного и они общие со сборщиком: один человек не должен выбрать все.
// ponytail: счётчик в памяти процесса; второй экземпляр API — считать в базе.
const recent = new Map<number, number[]>();
function tooOften(userId: number): boolean {
  const times = (recent.get(userId) ?? []).filter((t) => Date.now() - t < 60_000);
  if (times.length >= settings.botMessagesPerMinute) return true;
  if (recent.size > 10_000) recent.clear();
  recent.set(userId, [...times, Date.now()]);
  return false;
}

const RSVP_WORDS = { approved: 'идёт', maybe: 'думает', declined: 'не идёт', waitlist: 'в листе ожидания' } as const;

/**
 * Что сервис знает о собеседнике — первым сообщением в переписке для роли поддержки. Только его собственные
 * события и записи: чужих данных у роли нет, поэтому показать их по ошибке она не может.
 * ponytail: до 10 ближайших событий каждого вида; по своим событиям — отдельный запрос за числом гостей.
 */
async function supportContext(db: Db, actor: User): Promise<SupportTurn> {
  const soon = <T>(items: T[], at: (item: T) => string | Date) => items.filter((i) => new Date(at(i)).getTime() > Date.now() - 86_400_000).slice(0, 10);
  const events = soon(await listEvents(db, actor), (e) => e.event.start_at);
  const hosted = await Promise.all(events.filter((e) => e.is_host).map(async ({ event }) => {
    const { guest_counts: n } = await getEvent(db, actor, event.id);
    return `- «${event.name}», ${event.start_at.toISOString()} (${event.timezone}), ${event.status}; идут: ${n.approved}, думают: ${n.maybe}, отказались: ${n.declined}`;
  }));
  const answered = events.filter((e) => !e.is_host && e.my_approval_status)
    .map(({ event, my_approval_status }) => `- «${event.name}», ${event.start_at.toISOString()} (${event.timezone}) — ${RSVP_WORDS[my_approval_status!]}`);
  const collected = soon(await myCollectedEvents(db, actor), (c) => c.event.starts_at)
    .map(({ event, signed_up }) => `- «${event.title}», ${event.starts_at} — ${signed_up ? 'нажимал «Записаться» (место подтверждает организатор)' : 'только смотрел'}`);
  const section = (title: string, lines: string[]) => `${title}:\n${lines.length ? lines.join('\n') : '- нет'}`;
  return {
    role: 'system',
    content: [
      `Данные сервиса о собеседнике (${actor.first_name}). Это его собственные события и записи — их можно ему показывать. Данных о других людях здесь нет.`,
      `Билет для инструментов person_* (действует полчаса, человеку не показывай): ${issueTicket(actor.id)}`,
      section('События, которые он создал', hosted),
      section('События, на которые он ответил', answered),
      section('События из каталога, которые он открывал', collected),
    ].join('\n\n'),
  };
}

/**
 * Карточка события каталога под ответом поддержки: обложка, когда, где, цена и кнопка, которая открывает событие
 * в мини-приложении. Ссылку и картинку собираем сами, а не берём из текста роли: так они всегда настоящие.
 * Нет такого события (роль ошиблась id, событие сняли) — карточку пропускаем.
 */
async function sendEventCard(db: Db, chatId: number, id: string): Promise<void> {
  const event = await getCollectedEvent(db, id).catch(() => null);
  if (!event) return;
  const caption = [
    event.title,
    `🗓 ${collectedWhen(event.starts_at)}`,
    ...(event.place ? [`📍 ${event.place}`] : []),
    ...(event.price ? [`💸 ${event.price}`] : []),
  ].join('\n');
  const reply_markup = { inline_keyboard: [[{ text: 'Открыть событие', url: collectedUrl(event.id) }]] };
  const photo = event.cover_url && (await bot.send('sendPhoto', { chat_id: chatId, photo: event.cover_url, caption, reply_markup }, 'agent:support'));
  // Обложки нет или Telegram её не забрал — та же карточка текстом.
  if (!photo || !photo.ok) await bot.send('sendMessage', { chat_id: chatId, text: caption, reply_markup }, 'agent:support');
}

/** Чаще обновлять живой ответ не стоит: Telegram ограничивает sendMessageDraft так же, как «печатает». */
const DRAFT_MS = 1000;
/** Живой ответ у человека держится ~30 с: пока роль думает дольше (ходит в инструменты), показываем его заново. */
const DRAFT_KEEP_MS = 20_000;

/**
 * Живой ответ (CONTEXT.md): ответ роли появляется у человека по мере того, как она его пишет (sendMessageDraft,
 * Bot API 9.5): сначала «Думаю…», потом текст. Он временный — готовый ответ после `run` всё равно уходит обычным сообщением и заменяет его.
 * Текст показываем не сразу, а через DRAFT_MS: при сбое Hermes присылает текст ошибки одним куском перед признаком
 * сбоя, и за эту задержку мы узнаём о сбое раньше, чем покажем ошибку человеку.
 */
async function withDraft<T>(chatId: number, draftId: number, run: (show: (text: string) => void) => Promise<T>): Promise<T> {
  let text = '';
  let timer: NodeJS.Timeout | undefined;
  let inflight: Promise<unknown> = Promise.resolve();
  const call = (body: object): Promise<boolean> =>
    (inflight = bot.call('sendMessageDraft', { chat_id: chatId, draft_id: draftId, ...body }).then((r) => r.ok, () => false));
  const push = () => {
    timer = undefined;
    void call({ text: text.slice(0, 4096) });
  };
  // Пустой текст — «Думаю…»; Telegram его не принял — хотя бы «печатает».
  void call({ text: '' }).then((ok) => ok || void bot.call('sendChatAction', { chat_id: chatId, action: 'typing' }));
  const keep = setInterval(push, DRAFT_KEEP_MS);
  try {
    return await run((next) => {
      text = next;
      timer ??= setTimeout(push, DRAFT_MS);
    });
  } finally {
    clearTimeout(timer);
    clearInterval(keep);
    // Живой ответ, долетевший после готового сообщения, показался бы снова поверх него.
    await inflight;
  }
}

/** Обрабатывает одно обновление вебхука. `extract` нет — на сервере не задан GEMINI_API_KEY. */
export async function handleUpdate(db: Db, extract: Extract | undefined, update: unknown): Promise<void> {
  if (await handleFeedbackCallback(db, update)) return; // оценка события кнопкой под карточкой
  const m = parseIncoming(update);
  if (!m) return;
  // Любое сообщение боту, в том числе /start, заводит пользователя: вместе с ним сохраняется его аватар.
  const actor = await upsertUser(db, m.from);
  const conversation = await recordIncoming(db, m);
  // Отказ бота — повод нам заглянуть в диалог: человек хотел чего-то, чего бот не сделал.
  const say = async (text: string) => {
    await bot.send('sendMessage', { chat_id: m.chatId, text });
    await setAttention(db, conversation.id, 'Бот не создал событие');
  };
  // Ответ на «что понравилось и что улучшить?» — текст отзыва о событии, а не анонс и не вопрос.
  if (m.replyTo && m.text && await saveFeedbackComment(db, actor.id, m.replyTo, m.text)) {
    return void (await bot.send('sendMessage', { chat_id: m.chatId, text: 'Спасибо! Отзыв сохранён, организатор его увидит.' }));
  }
  // Команда или сообщение без текста — просто справка, без пометки: иначе каждый /start ждал бы нас.
  if (!m.text || m.text.startsWith('/')) return void (await bot.send('sendMessage', { chat_id: m.chatId, text: REPLIES.help }));
  // Диалог ждёт человека: пометка в админке и сообщение нам в Telegram.
  const callHuman = async (reason: string) => {
    await setAttention(db, conversation.id, reason);
    await alertAdmins(conversation, reason);
  };
  // Диалог ведём мы сами: бот молчит, пока человек не прислал анонс.
  if (conversation.mode === 'human' && !looksLikeEvent(m.text)) return callHuman('Ответил вам');
  // Тот же дешёвый отсев, что у сборщика: без признака даты события нет, ИИ не тратим.
  // Не анонс, а вопрос — отвечает роль поддержки (support.ts). Её нет, она недоступна или человек пишет
  // слишком часто — прежний отказ бота `refusal`.
  const answer = async (refusal: string, limited = tooOften(m.from.id)) => {
    const allowed = !settings.supportUserIds.length || settings.supportUserIds.includes(m.from.id);
    if (!settings.supportUrl || !allowed || limited) return say(refusal);
    const history = [await supportContext(db, actor), ...(await supportHistory(db, conversation.id))];
    // Ответ пишется у человека на глазах (живой ответ) и у нас в админке (live.ts).
    const reply = await writing(conversation.id, 'support', (live) =>
      withDraft(m.chatId, m.messageId, (draft) => support.ask(history, (text) => (live(text), draft(text)))));
    if (!reply) return say(refusal);
    if (reply.text) await bot.send('sendMessage', { chat_id: m.chatId, text: reply.text }, 'agent:support');
    for (const id of reply.events ?? []) await sendEventCard(db, m.chatId, id);
    if (reply.human) await callHuman(reply.human);
  };
  if (!looksLikeEvent(m.text)) return answer(REPLIES.no_date);
  if (!extract) return say(REPLIES.unavailable);
  if (tooOften(m.from.id)) return say(REPLIES.too_often);

  let found: CollectedEvent[];
  try {
    found = await extract({ id: `bot/${m.chatId}/${m.messageId}`, text: m.text, published_at: m.publishedAt, author_username: m.authorUsername });
  } catch (e) {
    console.error(e); // чаще всего лимит запросов бесплатного уровня Gemini
    return say(REPLIES.unavailable);
  }
  const dated = found.filter((e) => !Number.isNaN(Date.parse(e.starts_at)));
  // Дата в тексте есть, а события нет («что будет в пятницу?») — тоже вопрос. Лимит уже посчитан перед разбором.
  if (!dated.length) return answer(REPLIES.not_event, false);
  const upcoming = dated.filter((e) => Date.parse(e.ends_at ?? e.starts_at) >= Date.now());
  if (!upcoming.length) return say(REPLIES.past);

  // Своё — то, что человек написал сам, переслал от себя же, или где контактом для записи указан он
  // (то же правило, что при подтверждении собранного события). Остальное пересланное — чужое.
  const own = !m.origin || m.origin.userId === actor.id;
  const isContact = (e: CollectedEvent) => !!actor.username && e.telegram_username?.replace(/^@/, '').toLowerCase() === actor.username.toLowerCase();
  // В публикации с расписанием каждое событие создаётся отдельно; свои — пока хватает лимита.
  for (const [i, extracted] of upcoming.entries()) {
    try {
      if (!own && !isContact(extracted)) {
        await notify(m.chatId, 'event_collected', { item: await addCollectedEvent(db, sourceOf(m), i, extracted) });
        continue;
      }
      const { event } = await createEventFromAnnouncement(db, actor, extracted);
      await notify(m.chatId, 'event_created', { event });
    } catch (e) {
      if (e instanceof AppError && e.code === 'events_limit') return say(REPLIES.limit(upcoming.length - i));
      if (e instanceof AppError && e.code === 'feature_off') return say(REPLIES.not_host);
      throw e;
    }
  }
}
