// Полки витрины в админке (ADR-0009): подписи и перестановка. Чистые функции, тест — shelves.test.ts.
import type { ShelfAuthor, ShelfPeriod, ShelfRule, ShelfStatus } from '@yaswami/core';

export const PERIODS: Record<ShelfPeriod, string> = {
  tonight: 'сегодня вечером', today: 'сегодня', tomorrow: 'завтра', weekend: 'на выходных', week: 'на неделе',
};
export const STATUSES: Record<ShelfStatus, string> = { proposed: 'предложена', published: 'на витрине', hidden: 'снята' };
export const AUTHORS: Record<ShelfAuthor, string> = { team: 'Команда', curator: 'ИИ' };

/** Как собирается полка, одной строкой: «по правилу: на неделе · танцы · без опыта» или «вручную: 3 события». */
export function shelfHow(shelf: { rule: ShelfRule | null; event_ids: string[] }): string {
  if (!shelf.rule) return `вручную: ${shelf.event_ids.length} ${plural(shelf.event_ids.length, 'событие', 'события', 'событий')}`;
  const r = shelf.rule;
  const parts = [r.period && PERIODS[r.period], r.topic, r.free && 'бесплатно', r.beginner_friendly && 'без опыта', r.popular && 'популярное'].filter(Boolean);
  return `по правилу: ${parts.join(' · ') || 'все предстоящие'}`;
}

const plural = (n: number, one: string, few: string, many: string) => {
  const d = n % 10, h = n % 100;
  return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
};

/**
 * Сдвинуть полку на место выше (−1) или ниже (+1). Возвращает только полки, у которых меняется `position`: новый порядок —
 * их места в списке 0…n−1, так что одинаковые позиции (куратор поставил две полки на 0) заодно расходятся.
 */
export function moveShelf<T extends { id: string; position: number }>(shelves: T[], id: string, step: -1 | 1): { id: string; position: number }[] {
  const from = shelves.findIndex((s) => s.id === id);
  const to = from + step;
  if (from < 0 || to < 0 || to >= shelves.length) return [];
  const order = [...shelves];
  [order[from], order[to]] = [order[to]!, order[from]!];
  return order.flatMap((s, position) => (s.position === position ? [] : [{ id: s.id, position }]));
}
