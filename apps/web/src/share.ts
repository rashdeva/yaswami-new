import { TEMPLATES } from '@yaswami/core';
import type { EventData } from './api.ts';
import { eventLink, when } from './format.ts';
import { inTelegram, tg } from './tg.ts';

/** «Позвать друзей»: сразу открывает выбор чата Telegram (там же есть «скопировать ссылку»). Вызывать из обработчика нажатия. */
export function shareEvent(event: EventData['event'], ref: number | undefined, toast: (text: string) => void) {
  shareLink(eventLink(event.id, ref), `${TEMPLATES[event.kind].emoji} ${event.name}
${when(event.start_at, event.timezone)}`, toast);
}

/** Открывает выбор чата Telegram со ссылкой (в браузере: системное «Поделиться», иначе копирует). */
export function shareLink(link: string, text: string, toast: (text: string) => void) {
  // ponytail: пока в чат уходит ссылка на событие. Сообщение с кнопками ответа прямо в чате —
  // когда у бота появится шаринг (savePreparedInlineMessage + shareMessage).
  if (inTelegram) tg!.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
  else if (navigator.share) void navigator.share({ text, url: link }).catch(() => {});
  else navigator.clipboard.writeText(link).then(() => toast('Ссылка скопирована'), () => toast('Не получилось скопировать'));
}
