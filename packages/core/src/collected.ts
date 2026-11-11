// Показ собранных событий: одинаково на сервере (страницы для поисковиков) и на фронте.
import type { CollectedEventItem } from './api.ts';

// Время события записано в самой строке ISO вместе со сдвигом города. Берём «настенные» цифры как есть,
// чтобы показ не зависел ни от часового пояса устройства, ни от того, знает ли браузер этот сдвиг.
const wallClock = (iso: string) => new Date(iso.slice(0, 19) + 'Z');
const part = (iso: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('ru', { timeZone: 'UTC', ...options }).format(wallClock(iso));

/** Ключ дня для группировки: YYYY-MM-DD по времени города. */
export const collectedDayKey = (iso: string) => iso.slice(0, 10);
/** «пятница, 14 ноября». */
export const collectedDay = (iso: string) => part(iso, { weekday: 'long', day: 'numeric', month: 'long' });
/** «19:00»; пусто, если время в анонсе не указано (сборщик записывает такие события на 00:00). */
export const collectedTime = (iso: string) => (iso.slice(11, 16) === '00:00' ? '' : iso.slice(11, 16));
/** «пт, 14 ноября, 19:00». */
export function collectedWhen(iso: string): string {
  const time = collectedTime(iso);
  return part(iso, { weekday: 'short', day: 'numeric', month: 'long' }) + (time && `, ${time}`);
}

/** Прошло ли событие. Без времени окончания считаем, что оно длится три часа. */
export const collectedIsPast = (e: Pick<CollectedEventItem, 'starts_at' | 'ends_at'>, now = Date.now()) =>
  new Date(e.ends_at ?? e.starts_at).getTime() + (e.ends_at ? 0 : 3 * 3600e3) < now;

/** Адрес страницы события на сайте. */
export const collectedPath = (id: string) => `/e/${encodeURIComponent(id)}`;
