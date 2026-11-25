// Календари (Calendar, как в Luma): вывеска, в которую входят источники одной площадки, сообщества или организатора —
// его Telegram-канал и Instagram-профиль. У каждого источника есть календарь; склеить два источника — перенести один
// в календарь другого (admin_sources_update, calendar_id). Пока календари видит только команда.
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { AdminCalendar, CalendarUpdateInput } from '@yaswami/core';
import { instagramOf, suggestCalendarKind } from '@yaswami/core';
import type { Ctx } from '../audit.ts';
import { audited } from '../audit.ts';
import type { Db } from '../db/client.ts';
import { calendars, collectedEvents, collectorCursors, hosts, sources } from '../db/schema.ts';
import { AppError } from '../services.ts';
import { listSources } from './sources.ts';

/** Новый календарь для источника без своего: имя — ник в Instagram или username канала, команда переименует. */
export async function newCalendar(db: Db, channel: string): Promise<string> {
  const [row] = await db.insert(calendars).values({ name: instagramOf(channel) ?? channel }).returning({ id: calendars.id });
  return row!.id;
}

/**
 * Источник стал источником организатора (у календаря появился организатор или источник перенесли в его календарь):
 * сборщик перечитает свежие публикации — анонсы без контакта, которые он раньше пропустил, получат контактом
 * организатора. Если у организатора нет канала или Instagram, этот источник становится ими: из канала берутся фото.
 * ponytail: канал организатора — не часть снимка источника или календаря, отмена его не вернёт; поправить — в карточке организатора.
 */
export async function adoptForHost(db: Db, channel: string, hostId: string) {
  await db.delete(collectorCursors).where(eq(collectorCursors.channel, channel));
  const instagram = instagramOf(channel);
  if (instagram) await db.update(hosts).set({ instagram_handle: instagram }).where(and(eq(hosts.id, hostId), isNull(hosts.instagram_handle)));
  else if (!channel.startsWith('-')) await db.update(hosts).set({ channel: channel.toLowerCase() }).where(and(eq(hosts.id, hostId), isNull(hosts.channel)));
}

/** За сколько дней события подсказывают вид календаря: старые анонсы могли быть до смены формата канала. */
const KIND_DAYS = 90;

/**
 * Для подсказки вида: сколько событий, разных контактов для записи и тем у календаря за KIND_DAYS дней. Контакт —
 * Telegram, иначе WhatsApp, иначе Instagram; ссылка записи не считается: у каждого события она своя.
 */
async function kindStats(db: Db) {
  const e = collectedEvents;
  const rows = await db.select({
    calendar_id: sources.calendar_id,
    events: sql<number>`count(*)::int`,
    contacts: sql<number>`count(distinct coalesce(lower(${e.telegram_username}), ${e.event}->>'whatsapp_phone', lower(${e.event}->>'instagram_username')))::int`,
    topics: sql<number>`count(distinct ${e.event}->>'topic')::int`,
  }).from(e).innerJoin(sources, sql`lower(${sources.channel}) = lower(${e.channel})`)
    .where(sql`${e.created_at} > now() - make_interval(days => ${KIND_DAYS})`)
    .groupBy(sources.calendar_id);
  return new Map(rows.map((r) => [r.calendar_id, r]));
}

/** Календари, у которых есть источники, — с источниками, организатором и подсказкой вида; новые сверху. */
export async function listCalendars(db: Db): Promise<AdminCalendar[]> {
  // По очереди, а не Promise.all: внутри действия команды это одна транзакция, одно соединение.
  const rows = await db.select({ calendar: calendars, host: { id: hosts.id, name: hosts.name, username: hosts.username } })
    .from(calendars).leftJoin(hosts, eq(hosts.id, calendars.host_id)).orderBy(desc(calendars.created_at));
  const all = await listSources(db);
  const stats = await kindStats(db);
  const byCalendar = Map.groupBy(all, (s) => s.calendar.id);
  return rows.flatMap(({ calendar, host }) => {
    const list = byCalendar.get(calendar.id);
    if (!list) return []; // пустой: из него всё перенесли
    const stat = stats.get(calendar.id);
    return [{
      ...calendar,
      host: host?.id ? host : null,
      suggested_kind: stat ? suggestCalendarKind(stat) : null,
      sources: list.map(({ calendar: _c, host: _h, ...s }) => s),
    }];
  });
}

async function getCalendar(db: Db, id: string): Promise<AdminCalendar> {
  const found = (await listCalendars(db)).find((c) => c.id === id);
  if (!found) throw new AppError('not_found', 404);
  return found;
}

/**
 * Переименовать календарь, указать его вид или организатора. Новый организатор становится организатором всех
 * источников календаря (adoptForHost). У организатора календарь один: если он уже есть — перенесите источники в него.
 */
export const updateCalendar = (db: Db, ctx: Ctx, id: string, input: CalendarUpdateInput): Promise<AdminCalendar> =>
  audited(db, ctx, { action: 'admin_calendars_update', entity: 'calendar', id, input }, async (tx) => {
    const before = await getCalendar(tx, id);
    if (input.host_id && input.host_id !== before.host?.id) {
      if (!(await tx.select({ id: hosts.id }).from(hosts).where(eq(hosts.id, input.host_id))).length) throw new AppError('host_not_found', 404);
      if ((await tx.select({ id: calendars.id }).from(calendars).where(eq(calendars.host_id, input.host_id))).length) throw new AppError('host_has_calendar', 409);
      for (const s of before.sources) await adoptForHost(tx, s.channel, input.host_id);
    }
    const values = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    if (Object.keys(values).length) await tx.update(calendars).set(values).where(eq(calendars.id, id));
    return getCalendar(tx, id);
  });

/** Календарь существует; его организатор (null — нет). */
export async function calendarHost(db: Db, id: string): Promise<string | null> {
  const [row] = await db.select({ host_id: calendars.host_id }).from(calendars).where(eq(calendars.id, id));
  if (!row) throw new AppError('calendar_not_found', 404);
  return row.host_id;
}
