import type { CSSProperties } from 'react';
import type { AppConfig, BotIntent, Event, HostFeedbackSummary } from '@yaswami/core';
import { botIntentUrl, collectedDay, collectedDayKey, collectedPath, TEMPLATES } from '@yaswami/core';

/** «пт, 20 ноября, 19:00» — во времени самого события, а не устройства. */
export function when(startAt: string, timezone: string): string {
  const date = new Date(startAt);
  if (Number.isNaN(date.getTime())) return 'дата не выбрана';
  const part = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('ru', { timeZone: timezone, ...options }).format(date);
  return `${part({ weekday: 'short', day: 'numeric', month: 'long' })}, ${part({ hour: '2-digit', minute: '2-digit' })}`;
}

/** Цвета шаблона для «воздуха» под контентом и градиентов. */
export const tint = (kind: Event['kind']) =>
  ({ '--a': TEMPLATES[kind].colors[0], '--b': TEMPLATES[kind].colors[1] }) as CSSProperties;

/** Иконка шаблона: файлы лежат в public/topics рядом с иконками Topic; у «другого» — общая с ними. */
export const kindIcon = (kind: Event['kind']) => `/topics/${kind === 'o' ? 'other' : `kind-${kind}`}.png`;

/** Постоянный цвет аватара по имени. */
export const hue = (name: string) => [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);

/** Локальная дата устройства как YYYY-MM-DD, со сдвигом в днях. */
export function localDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Имя бота и приложения приходят с сервера (он знает своего бота); переменные VITE_* — запасной вариант для разработки.
const link = { bot: import.meta.env.VITE_BOT_USERNAME || null, app: import.meta.env.VITE_APP_NAME || 'app' };
export function setLinkConfig(config: AppConfig) {
  link.bot = config.bot_username ?? link.bot;
  link.app = config.app_name;
}

/**
 * Чат с ботом. С намерением (BotIntent в core) бот сразу спрашивает нужное: что человек добавляет или о ком отзыв.
 * null — имя бота неизвестно.
 */
export const botChatLink = (intent?: BotIntent): string | null =>
  link.bot ? (intent ? botIntentUrl(link.bot, intent) : `https://t.me/${link.bot}`) : null;

/** Ссылка, по которой событие открывается у гостя. `ref` — id того, кто делится: так видно, кто кого позвал. */
export function eventLink(id: string, ref?: number): string {
  const start = id + (ref ? `-r${ref}` : '');
  return link.bot
    ? `https://t.me/${link.bot}/${link.app}?startapp=${start}`
    : `${location.origin}${location.pathname}?startapp=${start}`;
}

/** Ссылка на событие из открытого канала: в мини-апке (startapp=c_<id>), если id допустим для Telegram, иначе на сайт. */
export function collectedLink(id: string): string {
  return link.bot && /^[\w-]{1,60}$/.test(id) ? `https://t.me/${link.bot}/${link.app}?startapp=c_${id}` : location.origin + collectedPath(id);
}

/** Ссылка на страницу организатора: в мини-апке (startapp=h_<id без дефисов>, Telegram пускает до 64 знаков), иначе на сайт. */
export function hostLink(id: string): string {
  return link.bot ? `https://t.me/${link.bot}/${link.app}?startapp=h_${id.replaceAll('-', '')}` : `${location.origin}/hosts/${id}`;
}

/** Дата и время начала так, как они на стене в часовом поясе события: ['2026-11-20', '19:30']. */
export function wallParts(iso: string, timeZone: string): [string, string] {
  const [date, time] = new Date(iso).toLocaleString('sv-SE', { timeZone, hour12: false }).split(' ');
  return [date!, time!.slice(0, 5)];
}

/** Обратное: дата и время на стене часового пояса → момент (ISO). */
export function fromWall(date: string, time: string, timeZone: string): string {
  const guess = Date.parse(`${date}T${time}:00Z`);
  const [d, t] = wallParts(new Date(guess).toISOString(), timeZone);
  // ponytail: поправка по смещению в момент guess; в сам час перевода часов может промахнуться на час
  return new Date(guess - (Date.parse(`${d}T${t}:00Z`) - guess)).toISOString();
}

/** Заголовок дня в ленте: «Сегодня», «Завтра» или «пятница, 14 ноября». Сегодня — по дате устройства. */
export function dayLabel(wall: string): string {
  const key = collectedDayKey(wall);
  return key === localDate() ? 'Сегодня' : key === localDate(1) ? 'Завтра' : collectedDay(wall);
}

/** «1 услуга», «3 услуги», «14 услуг». */
export function servicesCount(n: number): string {
  const d = n % 10, h = n % 100;
  return `${n} ${d === 1 && h !== 11 ? 'услуга' : d >= 2 && d <= 4 && (h < 12 || h > 14) ? 'услуги' : 'услуг'}`;
}

/** «4 события», «5 событий», «21 событие». */
export function eventsCount(n: number): string {
  const d = n % 10, h = n % 100;
  return `${n} ${d === 1 && h !== 11 ? 'событие' : d >= 2 && d <= 4 && (h < 12 || h > 14) ? 'события' : 'событий'}`;
}


export const starsOf = (rating: number) => '★'.repeat(rating) + '☆'.repeat(5 - rating);

/**
 * Репутация организатора одной строкой: «★ 4,7 · оценок: 12 · были: 10». Пока оценок меньше трёх, средней нет
 * (FEEDBACK_AVERAGE_MIN в core) — тогда только «Были: 2». null — никто ещё не был.
 */
export function reputation({ count, average, attended_count }: HostFeedbackSummary): string | null {
  if (!attended_count) return null;
  return average === null ? `Были: ${attended_count}` : `★ ${average.toFixed(1).replace('.', ',')} · оценок: ${count} · были: ${attended_count}`;
}
