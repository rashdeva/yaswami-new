import type { CSSProperties } from 'react';
import type { Event } from '@yaswami/core';
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

/** Постоянный цвет аватара по имени. */
export const hue = (name: string) => [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);

/** Локальная дата устройства как YYYY-MM-DD, со сдвигом в днях. */
export function localDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Ссылка, по которой событие открывается у гостя. */
export function eventLink(id: string): string {
  const bot = import.meta.env.VITE_BOT_USERNAME;
  return bot
    ? `https://t.me/${bot}/${import.meta.env.VITE_APP_NAME ?? 'app'}?startapp=${id}`
    : `${location.origin}${location.pathname}?startapp=${id}`;
}
