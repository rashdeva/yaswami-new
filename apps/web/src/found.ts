// «Это ваши события?» — первый экран организатора, чьи события уже есть в афише (ADR-0014). Здесь — что спросить
// и что человек уже отложил; экран только рисует.
import type { CollectedEventItem } from '@yaswami/core';

const KEY = 'found_skipped';

/** События, о которых человек уже ответил «не сейчас» или снял отметку: больше не встречаем его этим экраном. */
export function skippedFound(): string[] {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function skipFound(ids: string[]): string[] {
  const all = [...new Set([...skippedFound(), ...ids])].slice(-200);
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* приватное окно: до перезагрузки */ }
  return all;
}

/** О чём спросить сейчас: события, которые можно подтвердить и о которых ещё не спрашивали. В профиле остаются все. */
export const foundToAsk = <T extends Pick<CollectedEventItem, 'id'>>(claimable: T[], skipped: string[]): T[] =>
  claimable.filter((c) => !skipped.includes(c.id));

/** Сколько человек уже нажали «Записаться» на эти события. */
export const foundSignups = (items: Pick<CollectedEventItem, 'signups_count'>[]): number => items.reduce((n, i) => n + (i.signups_count ?? 0), 0);

/** Русское число: 1 событие, 2 события, 5 событий. */
export const plural = (n: number, one: string, few: string, many: string): string => {
  const d = n % 10, h = n % 100;
  return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
};

/** Подпись главной кнопки по числу отмеченных. */
export const foundCta = (picked: number): string =>
  picked === 0 ? 'Это не мои события' : picked === 1 ? 'Да, это моё событие' : picked === 2 ? 'Да, оба мои' : `Да, все ${picked} мои`;
