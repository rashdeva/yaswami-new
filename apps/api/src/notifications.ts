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
  buttons: { text: string; url: string }[]; // ссылки, по одной в ряд
  actions?: { text: string; callback_data: string }[]; // ряд кнопок-ответов над ссылками; нажатие приходит боту
}

// По символам, а не по UTF-16: не режем эмодзи пополам.
const cut = (s: string, n: number) => ([...s].length <= n ? s : [...s].slice(0, n - 1).join('') + '…');
const GUEST_NAME_MAX = 32;
const GUEST_NAME_SHORT = 16; // в сводке из нескольких имён
const WRITE_BUTTONS_MAX = 3;

/** Ссылка на событие: мини-приложение в Telegram, а пока имя бота неизвестно — сайт. */
export const eventUrl = (id: string) =>
  bot.username ? `https://t.me/${bot.username}/${bot.appName}?startapp=${id}` : `${settings.publicUrl}/?startapp=${id}`;

/** «пт, 14 ноября, 19:00» по часовому поясу события; без времени, если оно не указано (00:00). */
function when(event: Pick<Event, 'start_at' | 'timezone'>): string {
  const part = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('ru', { timeZone: event.timezone, ...options }).format(event.start_at);
  const time = part({ hour: '2-digit', minute: '2-digit' });
  return part({ weekday: 'short', day: 'numeric', month: 'long' }) + (time === '00:00' ? '' : `, ${time}`);
}
/** Ссылка на событие каталога: оно же в мини-приложении (startapp=c_<id>), а если id Telegram не примет — сайт. */
export const collectedUrl = (id: string) =>
  bot.username && /^[\w-]{1,60}$/.test(id) ? `https://t.me/${bot.username}/${bot.appName}?startapp=c_${id}` : settings.publicUrl + collectedPath(id);

const eventRows = (event: Event): Card['rows'] => [
  ['🗓', when(event)],
  ...(event.geo_address_json ? [['📍', event.geo_address_json.address] as [string, string]] : []),
];
const open = (event: Event) => ({ text: 'Открыть событие', url: eventUrl(event.id) });

const starsOf = (rating: number) => '★'.repeat(rating) + '☆'.repeat(5 - rating);
const COMMENT_SHOWN = 60;
const FRESH_SHOWN = 3;

export const templates = {
  /** Гостю после события: как прошло? Оценка — кнопками под сообщением, текст — ответом на следующее сообщение бота. */
  feedback_request: ({ event }: { event: Event }): Card => ({
    emoji: '💬', colors: ['#db2777', '#7c3aed'], label: 'Как всё прошло?', title: event.name,
    rows: [['🗓', when(event)], ['⭐', 'Оцените событие — это займёт секунду']],
    buttons: [],
    actions: [1, 2, 3, 4, 5].map((n) => ({ text: `${n} ⭐`, callback_data: `fb:${event.id}:${n}` })),
  }),
  /** Организатору: сводка отзывов. `fresh` — новые с прошлой сводки, `count` и `average` — по всем отзывам события. */
  feedback_received: (
    { event, count, average, fresh }: { event: Event; count: number; average: number; fresh: { first_name: string; rating: number; comment: string | null }[] },
  ): Card => ({
    emoji: '⭐', colors: ['#db2777', '#7c3aed'], label: fresh.length > 1 ? 'Новые отзывы' : 'Новый отзыв', title: event.name,
    rows: [
      ['⭐', `${average.toFixed(1).replace('.', ',')} из 5 · оценок: ${count}`],
      ...fresh.slice(0, FRESH_SHOWN).map((f): [string, string] =>
        ['💬', `${cut(f.first_name, GUEST_NAME_SHORT)}: ${starsOf(f.rating)}${f.comment ? ` ${cut(f.comment, COMMENT_SHOWN)}` : ''}`]),
      ...(fresh.length > FRESH_SHOWN ? [['…', `и ещё ${fresh.length - FRESH_SHOWN} — все отзывы на странице события`] as [string, string]] : []),
    ],
    buttons: [open(event)],
  }),
  /** Организатору: событие создано из его сообщения боту. */
  event_created: ({ event }: { event: Event }): Card => ({
    emoji: '✨', colors: ['#16a34a', '#0d9488'], label: 'Событие создано и подтверждено', title: event.name,
    rows: eventRows(event), buttons: [open(event)],
  }),
  /** Приславшему чужой анонс: событие принято как собранное и ждёт одобрения в админке; на витрине появится после него. */
  event_collected: ({ item }: { item: CollectedEventItem }): Card => {
    const where = [item.place, item.address].filter(Boolean).join(', ');
    return {
      emoji: '📌', colors: ['#2563eb', '#0891b2'], label: 'Отправлено на проверку', title: cut(item.title, NAME_MAX),
      rows: [['🗓', collectedWhen(item.starts_at)], ...(where ? [['📍', cut(where, ADDRESS_MAX)] as [string, string]] : []), ['⏳', 'Появится на витрине после проверки']],
      buttons: [{ text: 'Открыть на сайте', url: settings.publicUrl + collectedPath(item.id) }],
    };
  },
  /** Организатору: сводка — кто записался с прошлого уведомления. `going` — сколько мест уже занято. */
  guest_registered: ({ event, guests, going }: { event: Event; guests: Pick<User, 'first_name' | 'username'>[]; going: number }): Card => {
    const names = guests.map((g) => cut(g.first_name, guests.length > 1 ? GUEST_NAME_SHORT : GUEST_NAME_MAX));
    const who = names.length > 2 ? `${names[0]}, ${names[1]} и ещё ${names.length - 2}` : names.join(' и ');
    return {
      emoji: '🙌', colors: ['#f59e0b', '#ea580c'], label: names.length > 1 ? 'Новые записи' : 'Новая запись',
      title: `${who} ${names.length > 1 ? 'придут' : 'придёт'}`,
      rows: [['🎟', event.name], ['🗓', when(event)], ['👥', `Записано: ${going}${event.max_capacity ? ` из ${event.max_capacity}` : ''}`]],
      // Без username написать человеку по ссылке нельзя: tg://user?id=… Telegram отклоняет, если закрыта приватность.
      buttons: [
        ...guests.flatMap((g, i) => (g.username ? [{ text: `Написать: ${names[i]}`, url: `https://t.me/${g.username}` }] : [])).slice(0, WRITE_BUTTONS_MAX),
        open(event),
      ],
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
    reply_markup: { inline_keyboard: [...(card.actions ? [card.actions] : []), ...card.buttons.map((b) => [b])] },
  };
}

/** Отправляет уведомление. Никогда не бросает: недоставленное уведомление не должно ломать действие, которое его вызвало. */
export async function notify<K extends Moment>(chatId: number, moment: K, payload: MomentPayload<K>): Promise<void> {
  try {
    const { caption, reply_markup, ...widget } = toWidget((templates[moment] as (p: MomentPayload<K>) => Card)(payload));
    let sent = await bot.send('sendWidget', { chat_id: chatId, caption, reply_markup, ...widget });
    // Виджет не прошёл (метод недоступен, старый сервер) — то же самое обычным сообщением с кнопками.
    // 403 (человек не открывал или заблокировал бота) и 429 (лимит) вторым сообщением не лечатся.
    if (!sent.ok && sent.error_code !== 403 && sent.error_code !== 429) sent = await bot.send('sendMessage', { chat_id: chatId, text: caption, reply_markup });
    if (!sent.ok) console.error(`notify ${moment} → ${chatId}: ${sent.description}`);
  } catch (e) {
    console.error(`notify ${moment} → ${chatId}:`, e);
  }
}
