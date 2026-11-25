// Какие события попадут в афишу недели. Чистые функции: без сети и файлов, чтобы правило проверялось тестом.
import { collectedDayKey, collectedTime, type CollectedEventItem } from '@yaswami/core';

export interface PosterDay {
  day: string; // YYYY-MM-DD по времени города
  events: CollectedEventItem[]; // по времени начала
  more: number; // сколько событий этого дня не влезло в слайд
}

export interface PickOptions {
  from: string; // первый день афиши, YYYY-MM-DD
  days?: number; // сколько дней, по умолчанию неделя
  perDay?: number; // событий на слайд дня
}

/** Дни от `from` подряд: ['2026-11-26', '2026-11-27', …]. */
export function posterDays(from: string, days = 7): string[] {
  const start = Date.parse(from + 'T00:00:00Z');
  return Array.from({ length: days }, (_, i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10));
}

// Чем выше, тем охотнее берём событие в афишу. Вес подобран на глаз по живой витрине Дананга (ноябрь 2026).
function score(e: CollectedEventItem): number {
  return (e.popular ? 10 : 0)
    + (e.cover_url ? 3 : 0)
    + (collectedTime(e.starts_at) ? 2 : 0) // без времени гость не поймёт, когда идти
    + (e.place ? 1 : 0)
    + (e.takeaway || e.for_whom ? 1 : 0)
    + (e.beginner_friendly ? 1 : 0);
}

const titleKey = (e: CollectedEventItem) => e.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Лучшие события на каждый день. Одно и то же событие (цигун по вторникам и четвергам) за неделю берём один раз,
 * а темы чередуем: третья йога за день уступает квизу, даже если у неё счёт выше. Пустые дни выпадают.
 */
export function pickPosterDays(events: CollectedEventItem[], { from, days = 7, perDay = 3 }: PickOptions): PosterDay[] {
  const seenTitles = new Set<string>();
  const topicUses = new Map<string, number>();
  const result: PosterDay[] = [];
  for (const day of posterDays(from, days)) {
    const today = events.filter((e) => collectedDayKey(e.starts_at) === day);
    const picked: CollectedEventItem[] = [];
    const pool = [...today].sort((a, b) => score(b) - score(a) || a.starts_at.localeCompare(b.starts_at));
    while (picked.length < perDay) {
      const dayTopics = new Set(picked.map((e) => e.topic));
      const fresh = pool.filter((e) => !picked.includes(e) && !seenTitles.has(titleKey(e)));
      // За день тема не повторяется, пока есть другие; за неделю реже встречавшаяся тема идёт первой.
      const best = fresh
        .map((e) => ({ e, s: score(e) - (dayTopics.has(e.topic) ? 20 : 0) - (topicUses.get(e.topic ?? '') ?? 0) * 2 }))
        .sort((a, b) => b.s - a.s)[0]?.e;
      if (!best) break;
      picked.push(best);
      seenTitles.add(titleKey(best));
      topicUses.set(best.topic ?? '', (topicUses.get(best.topic ?? '') ?? 0) + 1);
    }
    if (picked.length) {
      result.push({ day, events: picked.sort((a, b) => a.starts_at.localeCompare(b.starts_at)), more: today.length - picked.length });
    }
  }
  return result;
}
