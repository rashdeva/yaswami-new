// Bot API: вызов метода и разбор входящего сообщения. Библиотек нет: виджеты (Bot API 10.4) они ещё не знают.
import type { TelegramUser } from './auth.ts';

export interface BotResult {
  ok: boolean;
  description?: string;
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
