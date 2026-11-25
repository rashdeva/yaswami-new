// Полка витрины (CONTEXT.md, ADR-0009): заголовок, обложка и набор предстоящих событий города. Витрина города —
// упорядоченный список полок. В Luma такого нет — это наше. Полки собирают команда и роль-куратор (agents/curator).
import * as z from 'zod';
import type { CollectedEventItem } from './api.ts';
import { cityId } from './api.ts';
import { collectedDayKey, collectedTime } from './collected.ts';
import { OTHER_TOPIC, isTopic } from './topics.ts';

/** Период полки по правилу, по времени города. В Luma такого нет. */
export const SHELF_PERIODS = ['tonight', 'today', 'tomorrow', 'weekend', 'week'] as const;
export type ShelfPeriod = (typeof SHELF_PERIODS)[number];

/**
 * proposed — предложил куратор, гости не видят, ждёт решения команды; published — на витрине; hidden — снята,
 * но не удалена. В Luma такого нет.
 */
export const SHELF_STATUSES = ['proposed', 'published', 'hidden'] as const;
export type ShelfStatus = (typeof SHELF_STATUSES)[number];

/** Кто собрал полку: человек из команды или роль-куратор. В Luma такого нет. */
export const SHELF_AUTHORS = ['team', 'curator'] as const;
export type ShelfAuthor = (typeof SHELF_AUTHORS)[number];

/**
 * Режим витрины города: draft — изменения куратора ждут команду (его новые полки — proposed, чужие он не трогает);
 * auto — куратор публикует сам. В Luma такого нет.
 */
export const SHOWCASE_MODES = ['draft', 'auto'] as const;
export type ShowcaseMode = (typeof SHOWCASE_MODES)[number];

/** Полка, где событий меньше, витрине не показывается: полупустая полка хуже, чем никакой. */
export const MIN_SHELF_EVENTS = 3;
/** Больше событий полка не показывает: дальше — «Все события» внизу витрины. */
export const SHELF_EVENTS_MAX = 20;
/** Сколько изменений полок куратор может сделать за сутки: витрина не должна меняться у людей каждый час. */
export const CURATOR_DAILY_CHANGES = 40;

const topic = z.string().refine((t) => t !== OTHER_TOPIC && isTopic(t), 'unknown topic');

/** Условие полки по правилу: все заданные поля должны совпасть. События считаются при каждом показе витрины. */
export const ShelfRule = z.object({
  period: z.enum(SHELF_PERIODS).optional().describe('tonight — today from 17:00; today; tomorrow; weekend — the nearest Saturday and Sunday; week — the next 7 days. Omit for all upcoming'),
  topic: topic.optional().describe('Topic name from topics_list'),
  free: z.boolean().optional().describe('true — only events whose price says it is free'),
  beginner_friendly: z.boolean().optional().describe('true — only events the organizer says need no experience'),
  popular: z.boolean().optional().describe('true — only events whose announcement got noticeably more response than usual for its channel'),
}).strict();
export type ShelfRule = z.infer<typeof ShelfRule>;

/** Полка, как её хранит сервис и видит команда. */
export interface Shelf {
  id: string;
  city_id: string;
  title: string; // как на витрине: «Сегодня вечером», «Баня недели»
  topic: string | null; // обложка — иконка этой темы; null — без обложки
  rule: ShelfRule | null; // полка по правилу; null — ручная, события в event_ids
  event_ids: string[]; // id собранных событий ручной полки, в порядке показа
  position: number; // порядок на витрине, меньше — выше
  status: ShelfStatus;
  pinned: boolean; // закреплена командой: куратор её не меняет
  author: ShelfAuthor;
  note: string | null; // почему полка такая — пишет автор правки, видит команда
  ends_at: Date | null; // после этого времени полка не показывается
  created_at: Date;
  updated_at: Date;
}

/** Полка для команды: сколько событий на ней сейчас и первые из них. */
export interface AdminShelf extends Shelf {
  events_count: number;
  events: Pick<CollectedEventItem, 'id' | 'title' | 'starts_at' | 'topic'>[];
}

/** Полка на витрине гостя. */
export interface ShowcaseShelf {
  id: string;
  title: string;
  topic: string | null;
  author: ShelfAuthor;
  events: CollectedEventItem[];
}

/** Витрина города: полки сверху вниз. Все события города по дням — по-прежнему `collected_events_list`. */
export interface Showcase {
  city_id: string;
  shelves: ShowcaseShelf[];
}

const eventId = z.string().min(1).max(200);
const fields = {
  title: z.string().trim().min(1).max(60).describe('Shelf title as people read it, in Russian, short: «Сегодня вечером», «Баня недели»'),
  topic: topic.nullable().describe('Topic whose icon is the shelf cover; null — no cover'),
  rule: ShelfRule.nullable().describe('Rule shelf: events are picked automatically on every view. null — a hand-picked shelf (event_ids)'),
  event_ids: z.array(eventId).max(SHELF_EVENTS_MAX).describe('Hand-picked shelf: collected event ids (id from collected_events_list) in display order. Ignored when rule is set'),
  position: z.number().int().min(0).max(10_000).describe('Order on the showcase, lower is higher'),
  status: z.enum(SHELF_STATUSES).describe('proposed — waits for the team; published — on the showcase; hidden — taken off'),
  pinned: z.boolean().describe('Team only: a pinned shelf is never changed by the curator'),
  note: z.string().trim().max(300).nullable().describe('Why the shelf is like this, for the team: «поднял: вчера 12 открытий»'),
  ends_at: z.iso.datetime({ offset: true }).nullable().describe('Stop showing after this time (ISO 8601); null — no end'),
};

export const ShelfCreateInput = z.object({
  city_id: cityId,
  ...fields,
  topic: fields.topic.optional(),
  rule: fields.rule.optional(),
  event_ids: fields.event_ids.optional(),
  position: fields.position.optional().describe('Order on the showcase, lower is higher; default — last'),
  status: fields.status.optional().describe('Default published; the curator in a city in draft mode always gets proposed'),
  pinned: fields.pinned.optional(),
  note: fields.note.optional(),
  ends_at: fields.ends_at.optional(),
});
export type ShelfCreateInput = z.infer<typeof ShelfCreateInput>;

/** Только переданные поля. Город полки не меняется. */
export const ShelfUpdateInput = z.object(fields).partial();
export type ShelfUpdateInput = z.infer<typeof ShelfUpdateInput>;

export const ShelfListInput = z.object({ city_id: cityId.optional() });
export type ShelfListInput = z.infer<typeof ShelfListInput>;

/** Полки города, у которого своих полок ещё нет: витрина работает сразу, до команды и куратора. */
export const DEFAULT_SHELVES: { title: string; topic: string | null; rule: ShelfRule }[] = [
  { title: 'Популярное', topic: null, rule: { popular: true } },
  { title: 'На выходных', topic: null, rule: { period: 'weekend' } },
  { title: 'Можно без опыта', topic: null, rule: { period: 'week', beginner_friendly: true } },
  { title: 'Сегодня вечером', topic: null, rule: { period: 'tonight' } },
  { title: 'Бесплатно', topic: null, rule: { period: 'week', free: true } },
];

// --- Отбор событий по правилу

/** «Сейчас» в часовом поясе города: YYYY-MM-DD и минуты от полуночи. Время событий записано в строке ISO по тому же поясу. */
export function cityNow(timezone: string, now = Date.now()): { day: string; minutes: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 — воскресенье

/** Дни периода по календарю города. «Выходные» — ближайшие суббота и воскресенье, в выходной — текущие. */
export function periodDays(period: ShelfPeriod, today: string): string[] {
  switch (period) {
    case 'tonight':
    case 'today': return [today];
    case 'tomorrow': return [addDays(today, 1)];
    case 'week': return Array.from({ length: 7 }, (_, i) => addDays(today, i));
    case 'weekend': {
      const d = weekday(today);
      if (d === 0) return [today];
      const saturday = addDays(today, 6 - d);
      return [saturday, addDays(saturday, 1)];
    }
  }
}

const TONIGHT_FROM = 17 * 60;
const isFree = (price: string | null) => /бесплатн|free/i.test(price ?? '');

/** Подходит ли событие под правило полки. `today` — день города (cityNow). */
export function matchesShelfRule(
  rule: ShelfRule, e: Pick<CollectedEventItem, 'starts_at' | 'price' | 'topic' | 'beginner_friendly' | 'popular'>, today: string,
): boolean {
  if (rule.period) {
    if (!periodDays(rule.period, today).includes(collectedDayKey(e.starts_at))) return false;
    if (rule.period === 'tonight') {
      const time = collectedTime(e.starts_at); // без времени в анонсе не знаем, вечер ли это
      if (!time || Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) < TONIGHT_FROM) return false;
    }
  }
  if (rule.topic && e.topic !== rule.topic) return false;
  if (rule.free && !isFree(e.price)) return false;
  if (rule.beginner_friendly && e.beginner_friendly !== true) return false;
  if (rule.popular && !e.popular) return false;
  return true;
}

/** События полки из предстоящих событий города (уже по времени): по правилу или по списку, не больше SHELF_EVENTS_MAX. */
export function shelfEvents(
  shelf: Pick<Shelf, 'rule' | 'event_ids'>, upcoming: CollectedEventItem[], today: string,
): CollectedEventItem[] {
  if (shelf.rule) return upcoming.filter((e) => matchesShelfRule(shelf.rule!, e, today)).slice(0, SHELF_EVENTS_MAX);
  const byId = new Map(upcoming.map((e) => [e.id, e]));
  return shelf.event_ids.flatMap((id) => byId.get(id) ?? []).slice(0, SHELF_EVENTS_MAX);
}

/**
 * Порядок полок для человека: полка темы, на которую он подписан, поднимается на два места. Порядок команды
 * остаётся основой, а закреплённое первое место не отдаём — это главное, что команда хочет показать.
 */
export function orderShelvesFor<T extends { topic: string | null }>(shelves: T[], subscribed: readonly string[]): T[] {
  if (!subscribed.length) return shelves;
  const lift = (s: T, i: number) => (i > 0 && s.topic && subscribed.includes(s.topic) ? i - 2.5 : i);
  return shelves.map((s, i) => [lift(s, i), s] as const).sort((a, b) => a[0] - b[0]).map(([, s]) => s);
}
