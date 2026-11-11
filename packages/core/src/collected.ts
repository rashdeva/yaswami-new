// Показ собранных событий: одинаково на сервере (страницы для поисковиков) и на фронте.
import type { CollectedEvent, CollectedEventItem } from './api.ts';

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

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[(s.length - 1) >> 1]! + s[s.length >> 1]!) / 2 : 0;
};

/**
 * Какие события «популярные»: публикация собрала заметно больше отклика, чем обычно собирают события этого источника.
 * Сравниваем только внутри источника: у большого канала просмотров больше всегда.
 * ponytail: наивное правило — порог от медианы предстоящих событий источника. Когда накопится история,
 * сравнивать с обычной публикацией канала за месяц и учитывать возраст публикации.
 */
export function popularIds<T extends { channel: string; views: number | null; reactions: number | null }>(
  rows: T[], id: (row: T) => string,
): Set<string> {
  const popular = new Set<string>();
  const groups = new Map<string, T[]>();
  for (const r of rows) groups.set(r.channel, [...(groups.get(r.channel) ?? []), r]);
  for (const group of groups.values()) {
    const reactions = Math.max(5, 2 * median(group.map((r) => r.reactions ?? 0)));
    // По просмотрам судим, только когда есть с чем сравнить: меньше четырёх событий — медиана ни о чём.
    const seen = group.flatMap((r) => r.views ?? []);
    const views = seen.length >= 4 ? 1.5 * median(seen) : Infinity;
    for (const r of group) if ((r.reactions ?? 0) >= reactions || (r.views ?? 0) > views) popular.add(id(r));
  }
  return popular;
}

/** Адрес страницы события на сайте. */
export const collectedPath = (id: string) => `/e/${encodeURIComponent(id)}`;

/**
 * Куда ведёт «Записаться»: чат организатора в Telegram с готовым сообщением, иначе WhatsApp, иначе ссылка
 * на регистрацию, иначе сам анонс. В сообщении — страница события на Ясвами: по ней организатор поймёт,
 * откуда пришёл человек, и сможет подтвердить событие как своё.
 */
export function collectedSignupUrl(
  event: Pick<CollectedEvent, 'title' | 'telegram_username' | 'whatsapp_phone' | 'url'>, sourceUrl: string, pageUrl: string,
): string {
  const text = encodeURIComponent(`Здравствуйте! Хочу записаться на «${event.title}». Нашёл событие на Ясвами: ${pageUrl}`);
  const username = event.telegram_username?.replace(/^@/, '');
  if (username && /^\w{4,32}$/.test(username)) return `https://t.me/${username}?text=${text}`;
  const phone = event.whatsapp_phone?.replace(/\D/g, '');
  if (phone) return `https://wa.me/${phone}?text=${text}`;
  if (/^https?:\/\//.test(event.url ?? '')) return event.url!;
  return sourceUrl;
}
