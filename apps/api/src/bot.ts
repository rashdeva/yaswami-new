// Сообщение боту. /start — приветствие с картинкой; всё остальное, в том числе анонсы и пересланные публикации,
// ведёт роль поддержки (support.ts): она отвечает, ищет события и создаёт их инструментами MCP.
import type { User } from '@yaswami/core';
import { collectedWhen } from '@yaswami/core';
import type { Db } from './db/client.ts';
import { upsertUser } from './auth.ts';
import { handleFeedbackCallback, saveFeedbackComment } from './feedback.ts';
import { alertAdmins, recordIncoming, setAttention, supportHistory } from './inbox.ts';
import { writing } from './live.ts';
import { collectedUrl } from './notifications.ts';
import { getCollectedEvent, getEvent, listEvents, myCollectedEvents } from './services.ts';
import { settings } from './settings.ts';
import { issueTicket, support } from './support.ts';
import type { SupportTurn } from './support.ts';
import { bot, parseIncoming } from './telegram.ts';

export const REPLIES = {
  /** Подпись к картинке на /start: до 1024 знаков (лимит подписи Telegram). Про создание события не спрашиваем. */
  welcome: [
    'Привет! Я «Я с вами», афиша сообщества Дананга 👋',
    'Здесь йога, баня, танцы, покер, лекции и встречи: собираю их из местных каналов, чтобы не искать по десяткам чатов.',
    '🗓 Подскажу, куда сходить сегодня или в выходные\n✍️ Запишу к организатору в пару нажатий\n🎉 Проводите события сами? Помогу завести событие и собрать гостей',
    'Просто напишите, что ищете, а всю афишу можно открыть в приложении.',
  ].join('\n\n'),
  photo: 'Пока я читаю только текст. Напишите словами, что ищете 🙂',
  too_often: 'Слишком много сообщений подряд. Подождите минуту и напишите ещё раз.',
  unavailable: 'Сообщение получили, ответим здесь чуть позже.',
};

/** Кнопка под приветствием: приложение внутри Telegram, как ссылка на афишу у роли поддержки. */
const APP_BUTTON = { inline_keyboard: [[{ text: 'Открыть афишу', url: 'https://t.me/yaswamibot/app' }]] };

/** Картинка приветствия: лежит в мини-приложении (apps/web/public), Telegram забирает её по ссылке. */
export const welcomePhotoUrl = () => `${settings.publicUrl}/welcome.jpg`;

/** Приветствие: картинка с подписью. */
async function sendWelcome(chatId: number): Promise<void> {
  const body = { chat_id: chatId, reply_markup: APP_BUTTON };
  const photo = await bot.send('sendPhoto', { ...body, photo: welcomePhotoUrl(), caption: REPLIES.welcome });
  // Telegram картинку не забрал (локальный адрес в разработке) — без приветствия человек всё равно не останется.
  if (!photo.ok) await bot.send('sendMessage', { ...body, text: REPLIES.welcome });
}

// Ответ роли стоит запроса к ИИ: один человек не должен выбрать все.
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

/**
 * Задержка перед показом написанного. Роль пишет текст быстро — с секундой готовое сообщение успевало раньше и
 * дописывания никто не видел. Признак сбоя Hermes приходит через миллисекунды после текста ошибки — 0,3 с хватает.
 */
export const DRAFT_MS = 300;
/** Пока текста нет. Пустой sendMessageDraft (Telegram пишет «Думаю…») некоторые клиенты рисуют пустым пузырём. */
export const DRAFT_PLACEHOLDER = 'Смотрю, что есть…';
/** Живой ответ у человека держится ~30 с: пока роль думает дольше (ходит в инструменты), показываем его заново. */
const DRAFT_KEEP_MS = 20_000;

/**
 * Живой ответ (CONTEXT.md): ответ роли появляется у человека по мере того, как она его пишет (sendMessageDraft,
 * Bot API 9.5): сначала DRAFT_PLACEHOLDER, потом текст. Он временный — готовый ответ после `run` всё равно уходит обычным сообщением и заменяет его.
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
    void call({ text: (text || DRAFT_PLACEHOLDER).slice(0, 4096) });
  };
  // Telegram живой ответ не принял — хотя бы «печатает».
  void call({ text: DRAFT_PLACEHOLDER }).then((ok) => ok || void bot.call('sendChatAction', { chat_id: chatId, action: 'typing' }));
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

/** Обрабатывает одно обновление вебхука. */
export async function handleUpdate(db: Db, update: unknown): Promise<void> {
  if (await handleFeedbackCallback(db, update)) return; // оценка события кнопкой под карточкой
  const m = parseIncoming(update);
  if (!m) return;
  // Любое сообщение боту, в том числе /start, заводит пользователя: вместе с ним сохраняется его аватар.
  const actor = await upsertUser(db, m.from);
  const conversation = await recordIncoming(db, m);
  // Бот не смог ответить — повод нам заглянуть в диалог.
  const say = async (text: string) => {
    await bot.send('sendMessage', { chat_id: m.chatId, text });
    await setAttention(db, conversation.id, 'Бот не ответил');
  };
  // Ответ на «что понравилось и что улучшить?» — текст отзыва о событии, а не вопрос.
  if (m.replyTo && m.text && await saveFeedbackComment(db, actor.id, m.replyTo, m.text)) {
    return void (await bot.send('sendMessage', { chat_id: m.chatId, text: 'Спасибо! Отзыв сохранён, организатор его увидит.' }));
  }
  // Команда — приветствие, без пометки: иначе каждый /start ждал бы нас.
  if (m.text.startsWith('/')) return sendWelcome(m.chatId);
  // Диалог ждёт человека: пометка в админке и сообщение нам в Telegram.
  const callHuman = async (reason: string) => {
    await setAttention(db, conversation.id, reason);
    await alertAdmins(conversation, reason);
  };
  // Диалог ведём мы сами: бот молчит.
  if (conversation.mode === 'human') return callHuman('Ответил вам');
  if (!m.text) return say(REPLIES.photo);
  // Всё остальное ведёт роль поддержки. Её нет, она недоступна — отвечаем, что вернёмся, и диалог ждёт нас.
  const allowed = !settings.supportUserIds.length || settings.supportUserIds.includes(m.from.id);
  if (!settings.supportUrl || !allowed) return say(REPLIES.unavailable);
  if (tooOften(m.from.id)) return say(REPLIES.too_often);
  const history = [await supportContext(db, actor), ...(await supportHistory(db, conversation.id))];
  // Ответ пишется у человека на глазах (живой ответ) и у нас в админке (live.ts).
  const reply = await writing(conversation.id, 'support', (live) =>
    withDraft(m.chatId, m.messageId, (draft) => support.ask(history, (text) => (live(text), draft(text)))));
  if (!reply) return say(REPLIES.unavailable);
  if (reply.text) await bot.send('sendMessage', { chat_id: m.chatId, text: reply.text }, 'agent:support');
  for (const id of reply.events ?? []) await sendEventCard(db, m.chatId, id);
  if (reply.human) await callHuman(reply.human);
}
