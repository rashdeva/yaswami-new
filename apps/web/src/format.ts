import type { CSSProperties } from 'react';
import type { AppConfig, Event } from '@yaswami/core';
import { TEMPLATES } from '@yaswami/core';

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

/** Ссылка, по которой событие открывается у гостя. `ref` — id того, кто делится: так видно, кто кого позвал. */
export function eventLink(id: string, ref?: number): string {
  const start = id + (ref ? `-r${ref}` : '');
  return link.bot
    ? `https://t.me/${link.bot}/${link.app}?startapp=${start}`
    : `${location.origin}${location.pathname}?startapp=${start}`;
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
