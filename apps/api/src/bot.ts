// Сообщение боту → событие. Человек пишет анонс или пересылает публикацию; бот разбирает её тем же механизмом,
// что и сборщик каналов (@yaswami/extract), создаёт событие на отправителя и отвечает виджетом.
import type { CollectedEvent } from '@yaswami/core';
import type { Announcement } from '@yaswami/extract';
import { looksLikeEvent } from '@yaswami/extract';
import { upsertUser } from './auth.ts';
import type { Db } from './db/client.ts';
import { notify } from './notifications.ts';
import { AppError, createEventFromAnnouncement } from './services.ts';
import { settings } from './settings.ts';
import { bot, parseIncoming } from './telegram.ts';

export type Extract = (announcement: Announcement) => Promise<CollectedEvent[]>;

export const REPLIES = {
  help: 'Пришлите анонс события текстом или перешлите публикацию — я создам событие: что, когда и где. Запись гостей и список — в приложении.',
  no_date: 'Не вижу здесь события: нет даты или сообщение слишком короткое. Пришлите анонс целиком — что будет, когда и где.',
  not_event: 'Это не похоже на анонс события с датой. Пришлите анонс целиком — что будет, когда и где.',
  past: 'Похоже, это событие уже прошло. Пришлите анонс предстоящего события.',
  unavailable: 'Сейчас не получилось разобрать сообщение. Попробуйте ещё раз через минуту.',
  limit: (left: number) =>
    `Бесплатно можно создать ${settings.freeEventsLimit} событий, лимит исчерпан.${left > 1 ? ` Не добавлено событий: ${left}.` : ''}`,
};

/** Обрабатывает одно обновление вебхука. `extract` нет — на сервере не задан GEMINI_API_KEY. */
export async function handleUpdate(db: Db, extract: Extract | undefined, update: unknown): Promise<void> {
  const m = parseIncoming(update);
  if (!m) return;
  const say = async (text: string) => void (await bot.call('sendMessage', { chat_id: m.chatId, text }));
  if (!m.text || m.text.startsWith('/')) return say(REPLIES.help);
  // Тот же дешёвый отсев, что у сборщика: без признака даты события нет, ИИ не тратим.
  if (!looksLikeEvent(m.text)) return say(REPLIES.no_date);
  if (!extract) return say(REPLIES.unavailable);

  let found: CollectedEvent[];
  try {
    found = await extract({ id: `bot/${m.chatId}/${m.messageId}`, text: m.text, published_at: m.publishedAt, author_username: m.authorUsername });
  } catch (e) {
    console.error(e); // чаще всего лимит запросов бесплатного уровня Gemini
    return say(REPLIES.unavailable);
  }
  const dated = found.filter((e) => !Number.isNaN(Date.parse(e.starts_at)));
  if (!dated.length) return say(REPLIES.not_event);
  const upcoming = dated.filter((e) => Date.parse(e.ends_at ?? e.starts_at) >= Date.now());
  if (!upcoming.length) return say(REPLIES.past);

  // Отправитель — организатор. В публикации с расписанием каждое событие создаётся отдельно, пока хватает лимита.
  const actor = await upsertUser(db, m.from);
  for (const [i, extracted] of upcoming.entries()) {
    try {
      const { event } = await createEventFromAnnouncement(db, actor, extracted);
      await notify(m.chatId, 'event_created', { event });
    } catch (e) {
      if (e instanceof AppError && e.code === 'events_limit') return say(REPLIES.limit(upcoming.length - i));
      throw e;
    }
  }
}
