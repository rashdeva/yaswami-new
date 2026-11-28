// Показ собранных событий: одинаково на сервере (страницы для поисковиков) и на фронте.
import type { CollectedEvent, CollectedEventItem } from './api.ts';
import type { Event } from './schema.ts';

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

/**
 * Началось ли событие: гостю начатое уже не показываем, даже если оно идёт до вечера. Время в анонсе не указано
 * (00:00) — считаем начавшимся только после конца того дня. То же правило — `notStarted` в apps/api/src/services.ts.
 */
export function collectedStarted(e: Pick<CollectedEventItem, 'starts_at'>, now = Date.now()): boolean {
  const start = Date.parse(e.starts_at);
  return collectedTime(e.starts_at) ? start <= now : start + 86_400_000 <= now;
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

/**
 * Пометка на карточке ленты: почему стоит открыть именно это событие, как на Booking. Наше: в Luma такого нет.
 * Просмотры и реакции наружу не показываем — они только поднимают событие пометкой «Популярное».
 */
export interface CollectedBadge {
  kind: 'soon' | 'hot' | 'free';
  label: string;
}

/** Пометки карточки, самые срочные первыми; не больше двух, чтобы карточка не превращалась в ёлку. */
export function collectedBadges(
  e: Pick<CollectedEventItem, 'starts_at' | 'ends_at' | 'price' | 'popular'>, now = Date.now(),
): CollectedBadge[] {
  const badges: CollectedBadge[] = [];
  // Без времени в анонсе (00:00) не знаем, когда начало, — «скоро» не ставим.
  const minutes = (new Date(e.starts_at).getTime() - now) / 60e3;
  if (collectedTime(e.starts_at) && !collectedIsPast(e, now)) {
    if (minutes <= 0) badges.push({ kind: 'soon', label: 'Уже идёт' });
    else if (minutes <= 180) badges.push({ kind: 'soon', label: minutes < 60 ? `Через ${Math.ceil(minutes)} мин` : `Через ${Math.round(minutes / 60)} ч` });
  }
  if (e.popular) badges.push({ kind: 'hot', label: 'Популярное' });
  if (/бесплатн|free/i.test(e.price ?? '')) badges.push({ kind: 'free', label: 'Бесплатно' });
  return badges.slice(0, 2);
}

/** Адрес страницы события на сайте. */
export const collectedPath = (id: string) => `/e/${encodeURIComponent(id)}`;

/**
 * Куда ведёт «Записаться»: чат организатора в Telegram с готовым сообщением, иначе WhatsApp, иначе ссылка
 * на регистрацию, иначе директ в Instagram (готовый текст ig.me не принимает), иначе сам анонс. В сообщении — страница события на Ясвами: по ней организатор поймёт,
 * откуда пришёл человек, и сможет подтвердить событие как своё.
 */
export function collectedSignupUrl(
  event: Pick<CollectedEvent, 'title' | 'telegram_username' | 'whatsapp_phone' | 'instagram_username' | 'url'>, sourceUrl: string, pageUrl: string,
): string {
  const text = encodeURIComponent(`Здравствуйте! Хочу записаться на «${event.title}». Нашёл событие на Ясвами: ${pageUrl}`);
  const username = event.telegram_username?.replace(/^@/, '');
  if (username && /^\w{4,32}$/.test(username)) return `https://t.me/${username}?text=${text}`;
  const phone = event.whatsapp_phone?.replace(/\D/g, '');
  if (phone) return `https://wa.me/${phone}?text=${text}`;
  if (/^https?:\/\//.test(event.url ?? '')) return event.url!;
  const instagram = event.instagram_username?.replace(/^@/, '');
  if (instagram && /^[\w.]{1,30}$/.test(instagram)) return `https://ig.me/m/${instagram}`;
  return sourceUrl;
}

/** Часть дня события: по ней экран «Все события» раскладывает день. `unknown` — время в анонсе не указано (00:00). В Luma такого нет. */
export const DAYPARTS = [
  { key: 'morning', label: 'Утро', emoji: '☀️' },
  { key: 'day', label: 'День', emoji: '🌤' },
  { key: 'evening', label: 'Вечер', emoji: '🌙' },
  { key: 'unknown', label: 'Время уточняется', emoji: '🕓' },
] as const;
export type Daypart = (typeof DAYPARTS)[number]['key'];

/** Утро — до 12:00, день — до 17:00, вечер — с 17:00, по часам города (время записано в строке ISO). */
export function collectedDaypart(iso: string): Daypart {
  const time = collectedTime(iso);
  if (!time) return 'unknown';
  const hour = Number(time.slice(0, 2));
  return hour < 12 ? 'morning' : hour < 17 ? 'day' : 'evening';
}

/** События одного дня по частям, в порядке DAYPARTS; пустые части не возвращаются. */
export function byDaypart<T extends Pick<CollectedEventItem, 'starts_at'>>(events: T[]): { part: (typeof DAYPARTS)[number]; events: T[] }[] {
  return DAYPARTS.map((part) => ({ part, events: events.filter((e) => collectedDaypart(e.starts_at) === part.key) })).filter((g) => g.events.length);
}

/**
 * Идентификатор собранного события в адресах: telegram:<канал>/<публикация>#<номер> ↔ <канал>-<публикация>-<номер>,
 * instagram:<код публикации>#<номер> ↔ ig.<код>-<номер>. В username Telegram точки нет — ig. с каналом не спутать.
 * Обратное — collectedExternalId в apps/api/src/services.ts. Здесь, а не в API: тем же id сборщик называет обложку в бакете.
 */
export const collectedSlug = (externalId: string): string => externalId.startsWith('instagram:')
  ? externalId.replace(/^instagram:(.+)#(\d+)$/, 'ig.$1-$2')
  : externalId.replace(/^telegram:/, '').replace(/\/(\d+)#(\d+)$/, '-$1-$2');

/** Ключ обложки собранного события в бакете (ADR-0011). Хэш содержимого — у каждой новой картинки свой файл. */
export const collectedCoverKey = (externalId: string, hash: string): string => `covers/collected/${collectedSlug(externalId)}-${hash}.jpg`;

// --- Событие из анонса ↔ строка события (ADR-0014). ИИ и сборщик говорят формой CollectedEvent (title, starts_at
// строкой со сдвигом города, place…), в базе это колонки события с именами как в Luma. Перевод — здесь, один на API и сборщик.

/** Момент времени строкой ISO со сдвигом пояса: «2026-12-05T17:00:00+07:00». Так время события уходит на фронт. */
export function isoInZone(at: Date, timeZone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at).map((p) => [p.type, p.value]));
  const wall = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  const minutes = Math.round((Date.parse(wall + 'Z') - at.getTime()) / 60_000);
  const abs = Math.abs(minutes);
  return `${wall}${minutes < 0 ? '-' : '+'}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

type ExternalColumns = Pick<Event,
  'name' | 'description' | 'start_at' | 'end_at' | 'time_tbd' | 'place' | 'geo_address_json' | 'display_price' | 'tags' | 'url'
  | 'telegram_username' | 'whatsapp_phone' | 'instagram_username' | 'topic' | 'what_happens' | 'for_whom' | 'beginner_friendly' | 'takeaway'>;

/** Контакт в колонке — без @ и в нижнем регистре: по нему вошедшему организатору предлагают подтвердить событие. */
const contact = (username: string | null | undefined) => username?.trim().replace(/^@/, '').toLowerCase() || null;

/** Колонки события из того, что извлёк ИИ. Время без часов в анонсе (00:00 в строке) — `time_tbd`. */
export function externalEventColumns(e: CollectedEvent): ExternalColumns {
  return {
    name: e.title, description: e.description || null,
    start_at: new Date(e.starts_at), end_at: e.ends_at ? new Date(e.ends_at) : null, time_tbd: e.starts_at.slice(11, 19) === '00:00:00',
    place: e.place || null, geo_address_json: e.address ? { address: e.address } : null,
    display_price: e.price || null, tags: e.tags ?? [], url: e.url || null,
    telegram_username: contact(e.telegram_username), whatsapp_phone: e.whatsapp_phone || null, instagram_username: contact(e.instagram_username),
    topic: e.topic ?? null, what_happens: e.what_happens ?? [], for_whom: e.for_whom ?? null,
    beginner_friendly: e.beginner_friendly ?? null, takeaway: e.takeaway ?? null,
  };
}

/** Обратно: событие в форме анонса — её читают карточки витрины, сборщик (склейка повторов) и задания иллюстратору. */
export function extractedOf(row: ExternalColumns & Pick<Event, 'timezone'>): CollectedEvent {
  return {
    title: row.name, description: row.description ?? '',
    starts_at: isoInZone(row.start_at, row.timezone), ends_at: row.end_at ? isoInZone(row.end_at, row.timezone) : null,
    place: row.place, address: row.geo_address_json?.address ?? null, price: row.display_price, tags: row.tags,
    telegram_username: row.telegram_username, whatsapp_phone: row.whatsapp_phone, instagram_username: row.instagram_username, url: row.url,
    ...(row.topic ? { topic: row.topic } : {}), what_happens: row.what_happens, for_whom: row.for_whom,
    beginner_friendly: row.beginner_friendly, takeaway: row.takeaway,
  };
}

/** Несут ли два события из анонсов одно и то же: сравниваем то, что ляжет в колонки, а не запись ИИ буква в букву. */
export const sameExtracted = (a: CollectedEvent, b: CollectedEvent): boolean =>
  JSON.stringify(externalEventColumns(a)) === JSON.stringify(externalEventColumns(b));
