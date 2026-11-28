// Хранитель тем (ADR-0010): роль Hermes agents/librarian раз в день разбирает темы и раскладку событий — заводит
// и выделяет темы, правит гиды, переносит события, снимает не-события, выключает размытые темы. Правит она сама,
// инструментами admin_* со своим токеном (область librarian); здесь — что ей можно, её лимит и расписание.
import { and, count, eq, gt, inArray, sql } from 'drizzle-orm';
import type { CollectedUpdateInput, TopicUpdateInput } from '@yaswami/core';
import { LIBRARIAN_DAILY_CHANGES, cityNow } from '@yaswami/core';
import type { Ctx } from './audit.ts';
import type { Db } from './db/client.ts';
import { adminActions, collectedEvents } from './db/schema.ts';
import { AppError, collectedExternalId, listCities } from './services.ts';
import { settings } from './settings.ts';
import { librarian } from './support.ts';

export const isLibrarian = (ctx: Ctx) => ctx.scope === 'librarian';

/** Не больше LIBRARIAN_DAILY_CHANGES правок за сутки — счёт по журналу, где у его правок область librarian. */
export async function assertLibrarianBudget(db: Db): Promise<void> {
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(adminActions)
    .where(and(sql`${adminActions.input}->>'scope' = 'librarian'`, gt(adminActions.created_at, sql`now() - interval '1 day'`)));
  if (n >= LIBRARIAN_DAILY_CHANGES) throw new AppError('too_many_changes', 409);
}

/**
 * У события хранитель меняет только тему и снимает с публикации (`status: rejected`): тексты, даты и контакты
 * написал организатор, решение «опубликовать» — за командой.
 */
export async function assertLibrarianMayEditEvent(db: Db, ctx: Ctx, slug: string, input: CollectedUpdateInput): Promise<void> {
  if (!isLibrarian(ctx)) return;
  if (Object.keys(input).some((k) => k !== 'topic' && k !== 'status') || (input.status && input.status !== 'rejected')) throw new AppError('forbidden', 403);
  await assertLibrarianBudget(db);
  if (input.status === 'rejected') await assertChannelRejections(db, slug);
}

/** Сколько событий одного канала хранитель может снять за сутки; остальное решает команда. */
export const LIBRARIAN_CHANNEL_REJECTIONS = 5;

/**
 * Хранитель читает тексты анонсов, а их пишет кто угодно: анонс может попросить «сними события такого-то». Снять разом
 * все события одного канала ему нельзя — сверх лимита отказ, решение за командой.
 */
async function assertChannelRejections(db: Db, slug: string): Promise<void> {
  const [target] = await db.select({ channel: collectedEvents.channel }).from(collectedEvents).where(eq(collectedEvents.external_id, collectedExternalId(slug)));
  if (!target) return;
  const done = await db.select({ id: adminActions.entity_id }).from(adminActions).where(and(
    sql`${adminActions.input}->>'scope' = 'librarian'`, sql`${adminActions.input}->>'status' = 'rejected'`,
    eq(adminActions.entity, 'collected_event'), gt(adminActions.created_at, sql`now() - interval '1 day'`),
  ));
  if (!done.length) return;
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(collectedEvents)
    .where(and(eq(collectedEvents.channel, target.channel), inArray(collectedEvents.external_id, done.map((d) => collectedExternalId(d.id)))));
  if (n >= LIBRARIAN_CHANNEL_REJECTIONS) throw new AppError('too_many_rejections', 409);
}

/** Тему хранитель заводит и правит, кроме иконки — её рисует иллюстратор. */
export async function assertLibrarianMayEditTopic(db: Db, ctx: Ctx, input?: TopicUpdateInput): Promise<void> {
  if (!isLibrarian(ctx)) return;
  if (input?.icon_url !== undefined) throw new AppError('forbidden', 403);
  await assertLibrarianBudget(db);
}

/** Задание роли на день: темы общие для всех городов, поэтому одно на сервис. */
export const librarianTask = (day: string, cities: string[]) =>
  `Разбери темы и раскладку событий на ${day}. Города: ${cities.join(', ')}. Начни с событий, собранных за последние сутки, затем кандидаты в темы.`;

// День, за который разбор уже сделан в этом процессе; `running` — задание у роли. Не ответила — следующий проход
// в тот же час спросит снова. ponytail: в памяти процесса, как у куратора (curator.ts).
let done: string | null = null;
let running = false;

/** Раз в день, в settings.librarianHour по часам первого города, — за час до куратора: витрина собирается по готовым темам. */
export async function requestLibrarian(db: Db, now = Date.now()): Promise<boolean> {
  if (!settings.librarianUrl || running) return false;
  const cities = await listCities(db);
  const home = cities.find((c) => c.id === settings.defaultCityId) ?? cities[0];
  if (!home) return false;
  const { day, minutes } = cityNow(home.timezone, now);
  if (Math.floor(minutes / 60) !== settings.librarianHour || done === day) return false;
  running = true;
  try {
    const report = await librarian.ask(librarianTask(day, cities.map((c) => `${c.name} (${c.id})`)));
    if (report !== null) done = day;
    console.log(`[librarian] ${day}: ${report ?? 'роль недоступна, спросим на следующем проходе'}`);
  } finally {
    running = false;
  }
  return true;
}

export function startLibrarianLoop(db: Db, everyMs = 10 * 60_000): void {
  const tick = () => requestLibrarian(db).catch(console.error);
  setInterval(tick, everyMs);
  void tick();
}
