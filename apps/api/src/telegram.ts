// Bot API: вызов метода и разбор входящего сообщения. Библиотек нет: виджеты (Bot API 10.4) они ещё не знают.
import type { TelegramUser } from './auth.ts';

export interface BotResult {
  ok: boolean;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const QUEUE_MAX = 1000;
let tail: Promise<unknown> = Promise.resolve();
let queued = 0;
let lastSent = 0;
const lastSentTo = new Map<number, number>();

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
  /**
   * Отправка сообщения в чат через очередь: выдерживает лимиты, а на 429 ждёт столько, сколько велел Telegram,
   * и повторяет один раз. Всё, что бот пишет людям, идёт отсюда, а не через `call`.
   * ponytail: очередь одна и в памяти — сообщение в «занятый» чат задерживает остальных на секунду, перезапуск
   * теряет неотправленное. Очереди по чатам или pgmq — когда уведомлений станет много.
   */
  send(method: string, body: { chat_id: number; [field: string]: unknown }): Promise<BotResult> {
    if (queued >= QUEUE_MAX) return Promise.resolve({ ok: false, description: 'send queue is full' });
    queued++;
    const run = tail.then(async () => {
      const wait = Math.max(lastSent + bot.pace.globalMs, (lastSentTo.get(body.chat_id) ?? 0) + bot.pace.chatMs) - Date.now();
      if (wait > 0) await sleep(wait);
      let result = await bot.call(method, body);
      if (result.error_code === 429) {
        await sleep(Math.min(result.parameters?.retry_after ?? 1, bot.pace.retryAfterMaxS) * 1000);
        result = await bot.call(method, body);
      }
      lastSent = Date.now();
      if (lastSentTo.size > 10_000) lastSentTo.clear();
      lastSentTo.set(body.chat_id, lastSent);
      return result;
    }).finally(() => queued--);
    tail = run.catch(() => {});
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
  origin: { userId?: number; username?: string; channel?: { id: number; username?: string; number: number } } | null;
}

interface TgMessage {
  message_id: number;
  date: number;
  chat: { id: number; type: string };
  from?: TelegramUser & { is_bot?: boolean };
  text?: string;
  caption?: string;
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
  };
}
