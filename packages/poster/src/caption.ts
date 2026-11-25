// Текст поста к карусели: тот же отбор, что на слайдах, — для подписи в Instagram и поста в Telegram-канале.
import { collectedDay, collectedTime, TOPIC_GUIDES, type CollectedEventItem } from '@yaswami/core';
import type { PosterDay } from './pick.ts';
import { plural, weekRange } from './render.ts';

const line = (e: CollectedEventItem) => {
  const emoji = (e.topic && TOPIC_GUIDES[e.topic]?.emoji) || '✨';
  const time = collectedTime(e.starts_at);
  const tail = [e.place, e.price && (e.price.length > 30 ? e.price.slice(0, 29).trimEnd() + '…' : e.price)].filter(Boolean).join(', ');
  return `${emoji} ${time ? time + ' ' : ''}${e.title}${tail ? ` — ${tail}` : ''}`;
};

export function posterCaption(days: PosterDay[], total: number, cityIn: string, bot: string): string {
  const shown = days.reduce((n, d) => n + d.events.length, 0);
  const head = `Куда пойти ${cityIn}: ${weekRange(days[0]!.day, days.at(-1)!.day)}`;
  const body = days.map((d) => {
    const day = collectedDay(d.day + 'T12:00:00+00:00');
    return `${day.charAt(0).toUpperCase() + day.slice(1)}\n${d.events.map(line).join('\n')}`;
  });
  const more = total - shown;
  return [head, ...body, `${more > 0 ? `Ещё ${more} ${plural(more, 'событие', 'события', 'событий')} и запись` : 'Запись'} — в Telegram @${bot}`, 'Сохрани, чтобы не потерять 📌'].join('\n\n');
}
