// Bot API: вызов метода и разбор входящего сообщения. Библиотек нет: виджеты (Bot API 10.4) они ещё не знают.
import type { TelegramUser } from './auth.ts';
import type { BotFile } from './media.ts';

export interface BotResult {
  ok: boolean;
  result?: unknown; // ответ метода; у отправки сообщений он нам не нужен
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const QUEUE_MAX = 1000;
const CHAT_QUEUE_MAX = 20; // один чат не может занять всю очередь
let queued = 0;
let nextGlobal = 0; // когда можно отправлять следующее сообщение с бота, в любой чат
const tails = new Map<number, { tail: Promise<unknown>; queued: number; lastSent: number }>();

/** Ждёт своей очереди в общем лимите бота: каждое сообщение бронирует следующий свободный момент. */
async function globalSlot(): Promise<void> {
  const at = Math.max(Date.now(), nextGlobal);
  nextGlobal = at + bot.pace.globalMs;
  if (at > Date.now()) await sleep(at - Date.now());
}

/** Настройки бота. Заполняет main.ts; тесты подменяют `call`. Без токена ничего не отправляется. */
export const bot = {
  token: '',
  /** Имя бота и короткое имя мини-приложения: из них собирается ссылка на событие. */
  username: null as string | null,
  appName: 'app',
  /** Вызов метода Bot API. Не бросает: недоступный Telegram — это `ok: false`. */
  async call(method: string, body: object): Promise<BotResult> {
    if (!bot.token) return { ok: false, description: 'BOT_TOKEN is not set' };
    try {
      const res = await fetch(`https://api.telegram.org/bot${bot.token}/${method}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
      });
      return (await res.json()) as BotResult;
    } catch (e) {
      return { ok: false, description: String(e) };
    }
  },
  /** Лимиты Telegram на исходящие: ~30 сообщений в секунду на бота и одно в секунду в один чат. Тесты обнуляют. */
  pace: { globalMs: 40, chatMs: 1000, retryAfterMaxS: 60 },
  /** Запись отправленного в переписку (inbox.ts). Ставит createApp: у самого бота базы нет. */
  log: undefined as ((method: string, body: { chat_id: number; [field: string]: unknown }, result: BotResult, author: string) => Promise<void>) | undefined,
  /**
   * Отправка сообщения в чат через очередь: выдерживает лимиты, а на 429 ждёт столько, сколько велел Telegram,
   * и повторяет один раз. Всё, что бот пишет людям, идёт отсюда, а не через `call`, и попадает в переписку;
   * `author` — от чьего имени сообщение: `bot` или `admin:<id>`. `chat_id` — Telegram id, а не users.id: пользователю
   * его даёт `telegramIdOf` (auth.ts), у кого его нет — тому бот не пишет (ADR-0008).
   * Очередь у каждого чата своя: флуд или 429 в одном чате не задерживают сообщения другим людям. Общий лимит бота
   * держит `globalSlot`.
   * ponytail: очереди в памяти — перезапуск теряет неотправленное; pgmq — когда уведомлений станет много.
   */
  send(method: string, body: { chat_id: number; [field: string]: unknown }, author = 'bot'): Promise<BotResult> {
    const chat = tails.get(body.chat_id) ?? { tail: Promise.resolve(), queued: 0, lastSent: 0 };
    if (queued >= QUEUE_MAX || chat.queued >= CHAT_QUEUE_MAX) return Promise.resolve({ ok: false, description: 'send queue is full' });
    queued++;
    chat.queued++;
    tails.set(body.chat_id, chat);
    const delivered = chat.tail.then(async () => {
      const wait = chat.lastSent + bot.pace.chatMs - Date.now();
      if (wait > 0) await sleep(wait);
      await globalSlot();
      let result = await bot.call(method, body);
      if (result.error_code === 429) {
        await sleep(Math.min(result.parameters?.retry_after ?? 1, bot.pace.retryAfterMaxS) * 1000);
        await globalSlot();
        result = await bot.call(method, body);
      }
      chat.lastSent = Date.now();
      return result;
    });
    chat.tail = delivered.catch(() => {});
    const done = () => {
      queued--;
      // Чат без очереди и давно без сообщений — забываем, чтобы карта не росла.
      if (--chat.queued === 0) setTimeout(() => { if (!chat.queued && tails.get(body.chat_id) === chat) tails.delete(body.chat_id); }, bot.pace.chatMs).unref();
    };
    // Запись в переписку очередь не задерживает: следующее сообщение уходит, не дожидаясь базы.
    // Сбой записи не должен ронять отправку.
    const run = delivered
      .then(async (result) => {
        await bot.log?.(method, body, result, author).catch(console.error);
        return result;
      })
      .finally(done);
    return run;
  },
};

/** Сообщение боту, приведённое к публикации (Announcement), которую разбирает ИИ. */
export interface Incoming {
  chatId: number;
  messageId: number;
  from: TelegramUser;
  text: string; // текст сообщения или подпись к фото; пусто, если текста нет
  publishedAt: string; // у пересланного — дата исходной публикации: от неё считаются «завтра» и «в субботу»
  authorUsername: string | null; // у пересланного из канала — null: канал не контакт для записи
  /** Откуда переслано; null — человек написал сам. `channel` — публикация канала, у неё есть адрес. */
  replyTo: number | null; // на какое сообщение человек ответил
  origin: { userId?: number; username?: string; channel?: { id: number; username?: string; number: number } } | null;
  /** Голосовое, видео, фото или файл в сообщении; null — только текст. */
  file: BotFile | null;
}

interface TgFile { file_id: string; file_size?: number; mime_type?: string; duration?: number; file_name?: string; width?: number }

interface TgMessage {
  message_id: number;
  date: number;
  chat: { id: number; type: string };
  from?: TelegramUser & { is_bot?: boolean };
  text?: string;
  caption?: string;
  voice?: TgFile;
  audio?: TgFile;
  video?: TgFile;
  video_note?: TgFile;
  animation?: TgFile;
  document?: TgFile;
  photo?: TgFile[];
  reply_to_message?: { message_id: number };
  forward_origin?: {
    type: string; date: number; sender_user?: { id: number; username?: string };
    chat?: { id: number; username?: string }; message_id?: number;
  };
}

/** null — обновление не про сообщение человека в личном чате с ботом. */
export function parseIncoming(update: unknown): Incoming | null {
  const m = (update as { message?: TgMessage } | null)?.message;
  if (!m?.from || m.from.is_bot || m.chat?.type !== 'private') return null;
  const origin = m.forward_origin;
  return {
    chatId: m.chat.id,
    messageId: m.message_id,
    from: { id: m.from.id, first_name: m.from.first_name, username: m.from.username, language_code: m.from.language_code },
    text: (m.text ?? m.caption ?? '').trim(),
    publishedAt: new Date((origin?.date ?? m.date) * 1000).toISOString(),
    replyTo: m.reply_to_message?.message_id ?? null,
    authorUsername: (origin ? origin.sender_user?.username : m.from.username) ?? null,
    origin: origin
      ? {
          userId: origin.sender_user?.id,
          username: origin.sender_user?.username,
          channel: origin.type === 'channel' && origin.chat && origin.message_id
            ? { id: origin.chat.id, username: origin.chat.username, number: origin.message_id }
            : undefined,
        }
      : null,
    file: botFile(m),
  };
}

/** Первое вложение сообщения. Фото — самый крупный размер, который Telegram уже приготовил (JPEG). */
function botFile(m: TgMessage): BotFile | null {
  const photo = m.photo?.at(-1);
  const [type, f] = m.voice ? ['voice', m.voice] as const : m.video_note ? ['video_note', m.video_note] as const : m.audio ? ['audio', m.audio] as const
    : m.video ? ['video', m.video] as const : m.animation ? ['video', m.animation] as const : photo ? ['photo', photo] as const : m.document ? ['document', m.document] as const : [null, null];
  if (!type) return null;
  const mime = f.mime_type ?? (type === 'photo' ? 'image/jpeg' : type === 'video_note' ? 'video/mp4' : null);
  return { type, file_id: f.file_id, file_size: f.file_size ?? null, mime_type: mime, duration: f.duration ?? null, file_name: f.file_name ?? null };
}
