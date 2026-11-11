// Уведомления бота: момент → шаблон → виджет. Новый момент — это новая запись в `templates`; отправка (`notify`)
// про моменты ничего не знает.
import { readFileSync } from 'node:fs';
import type { CollectedEventItem, Event, User } from '@yaswami/core';
import { ADDRESS_MAX, collectedPath, collectedWhen, NAME_MAX } from '@yaswami/core';
import { settings } from './settings.ts';
import { bot } from './telegram.ts';

/** То, что показывает виджет и повторяет подпись для клиентов без виджетов. */
export interface Card {
  emoji: string;
  colors: [string, string]; // градиент шапки
  label: string;
  title: string;
  rows: [icon: string, text: string][];
  buttons: { text: string; url: string }[];
}

// По символам, а не по UTF-16: не режем эмодзи пополам.
const cut = (s: string, n: number) => ([...s].length <= n ? s : [...s].slice(0, n - 1).join('') + '…');
const GUEST_NAME_MAX = 32;

/** Ссылка на событие: мини-приложение в Telegram, а пока имя бота неизвестно — сайт. */
export const eventUrl = (id: string) =>
  bot.username ? `https://t.me/${bot.username}/${bot.appName}?startapp=${id}` : `${settings.publicUrl}/?startapp=${id}`;

/** «пт, 14 ноября, 19:00» по часовому поясу события; без времени, если оно не указано (00:00). */
function when(event: Pick<Event, 'start_at' | 'timezone'>): string {
  const part = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('ru', { timeZone: event.timezone, ...options }).format(event.start_at);
  const time = part({ hour: '2-digit', minute: '2-digit' });
  return part({ weekday: 'short', day: 'numeric', month: 'long' }) + (time === '00:00' ? '' : `, ${time}`);
}
const eventRows = (event: Event): Card['rows'] => [
  ['🗓', when(event)],
  ...(event.geo_address_json ? [['📍', event.geo_address_json.address] as [string, string]] : []),
];
const open = (event: Event) => ({ text: 'Открыть событие', url: eventUrl(event.id) });

export const templates = {
  /** Организатору: событие создано из его сообщения боту. */
  event_created: ({ event }: { event: Event }): Card => ({
    emoji: '✨', colors: ['#16a34a', '#0d9488'], label: 'Событие создано и подтверждено', title: event.name,
    rows: eventRows(event), buttons: [open(event)],
  }),
  /** Приславшему чужой анонс: событие добавлено на витрину как собранное, организатора у него пока нет. */
  event_collected: ({ item }: { item: CollectedEventItem }): Card => {
    const where = [item.place, item.address].filter(Boolean).join(', ');
    return {
      emoji: '📌', colors: ['#2563eb', '#0891b2'], label: 'Добавлено на витрину', title: cut(item.title, NAME_MAX),
      rows: [['🗓', collectedWhen(item.starts_at)], ...(where ? [['📍', cut(where, ADDRESS_MAX)] as [string, string]] : [])],
      buttons: [{ text: 'Открыть на сайте', url: settings.publicUrl + collectedPath(item.id) }],
    };
  },
  /** Организатору: на событие записался гость. `going` — сколько мест уже занято. */
  guest_registered: ({ event, guest, going }: { event: Event; guest: Pick<User, 'first_name' | 'username'>; going: number }): Card => {
    const name = cut(guest.first_name, GUEST_NAME_MAX);
    return {
      emoji: '🙌', colors: ['#f59e0b', '#ea580c'], label: 'Новая запись', title: `${name} придёт`,
      rows: [['🎟', event.name], ['🗓', when(event)], ['👥', `Записано: ${going}${event.max_capacity ? ` из ${event.max_capacity}` : ''}`]],
      // Без username написать человеку по ссылке нельзя: tg://user?id=… Telegram отклоняет, если закрыта приватность.
      buttons: [...(guest.username ? [{ text: `Написать: ${name}`, url: `https://t.me/${guest.username}` }] : []), open(event)],
    };
  },
  /** Гостю: запись принята. */
  rsvp_confirmed: ({ event }: { event: Event }): Card => ({
    emoji: '✅', colors: ['#6366f1', '#a855f7'], label: 'Вы записаны', title: event.name,
    rows: eventRows(event), buttons: [open(event)],
  }),
};
export type Moment = keyof typeof templates;
export type MomentPayload<K extends Moment> = Parameters<(typeof templates)[K]>[0];

// Код виджета один на все шаблоны и не меняется; меняется состояние. Лимит Telegram — 4096 байт после zlib (тест).
export const widgetHtml = readFileSync(new URL('./widgets/card.html', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');

/** Параметры sendWidget для карточки. `public_data` — состояние виджета, не длиннее 1024 байт (тест). */
export function toWidget(card: Card) {
  return {
    html: widgetHtml,
    // Подпись обязательна: её видят клиенты, которые не умеют виджеты, и уведомление на заблокированном экране.
    caption: [`${card.emoji} ${card.label}: ${card.title}`, ...card.rows.map((r) => r.join(' '))].join('\n'),
    public_data: JSON.stringify({ e: card.emoji, c: card.colors, l: card.label, t: card.title, m: card.rows }),
    reply_markup: { inline_keyboard: card.buttons.map((b) => [b]) },
  };
}

/** Отправляет уведомление. Никогда не бросает: недоставленное уведомление не должно ломать действие, которое его вызвало. */
export async function notify<K extends Moment>(chatId: number, moment: K, payload: MomentPayload<K>): Promise<void> {
  try {
    const { caption, reply_markup, ...widget } = toWidget((templates[moment] as (p: MomentPayload<K>) => Card)(payload));
    let sent = await bot.call('sendWidget', { chat_id: chatId, caption, reply_markup, ...widget });
    // Виджет не прошёл (метод недоступен, старый сервер) — то же самое обычным сообщением с кнопками.
    if (!sent.ok) sent = await bot.call('sendMessage', { chat_id: chatId, text: caption, reply_markup });
    if (!sent.ok) console.error(`notify ${moment} → ${chatId}: ${sent.description}`);
  } catch (e) {
    console.error(`notify ${moment} → ${chatId}:`, e);
  }
}
