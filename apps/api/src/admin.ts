// Операции команды над всем сервисом: любое событие, любой пользователь, организаторы. Кто вправе их вызывать,
// решают входы (REST — `/admin/*`, MCP — блок для админа); сами операции прав не проверяют.
import { asc, eq, gt, ilike, or } from 'drizzle-orm';
import type { EventUpdateInput, User } from '@yaswami/core';
import type { Db } from './db/client.ts';
import { collectedEventSignups, events, hosts, users } from './db/schema.ts';
import { eventUrl } from './notifications.ts';
import * as s from './services.ts';
import { verifyTicket } from './support.ts';

export async function userById(db: Db, id: number): Promise<User> {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  if (!user) throw new s.AppError('user_not_found', 404);
  return user;
}

/** Собеседник роли поддержки: кто он, доказывает билет от нашего API (support.ts), а не слова человека. */
export async function userByTicket(db: Db, ticket: string): Promise<User> {
  const [user] = await db.select().from(users).where(eq(users.id, verifyTicket(ticket) ?? 0));
  if (!user) throw new s.AppError('bad_ticket', 403);
  return user;
}

/** Организатор события: от его имени команда смотрит и меняет любое событие — правила те же, что у него в приложении. */
async function hostOf(db: Db, id: string): Promise<User> {
  const [row] = await db.select({ host: users }).from(events).innerJoin(users, eq(users.id, events.user_id)).where(eq(events.id, id));
  if (!row) throw new s.AppError('not_found', 404);
  return row.host;
}

/** Все предстоящие события сервиса с именем организатора. */
export async function listAllEvents(db: Db) {
  const rows = await db
    .select({ event: events, host_id: users.id, host_name: users.first_name, host_username: users.username })
    .from(events).innerJoin(users, eq(users.id, events.user_id))
    .where(gt(events.start_at, new Date())).orderBy(asc(events.start_at)).limit(200); // ponytail: без страниц, пока событий меньше лимита
  return rows.map((r) => ({ ...r, url: eventUrl(r.event.id) }));
}

export const getAnyEvent = async (db: Db, id: string) => ({ ...(await s.getEvent(db, await hostOf(db, id), id)), url: eventUrl(id) });

export const updateAnyEvent = async (db: Db, id: string, input: EventUpdateInput) => s.updateEvent(db, await hostOf(db, id), id, input);

/** Люди, которые пользовались сервисом, по части имени или @username. */
export const searchUsers = (db: Db, query: string): Promise<User[]> =>
  db.select().from(users).where(or(ilike(users.first_name, `%${query}%`), ilike(users.username, `%${query.replace(/^@/, '')}%`))).limit(20);

/** Собранное событие с профилем организатора и теми, кто нажал «Записаться». */
export const getCollectedEventSignups = async (db: Db, slug: string) => ({
  ...(await s.getCollectedEvent(db, slug)),
  signups: await db.select({ id: users.id, first_name: users.first_name, username: users.username, at: collectedEventSignups.created_at })
    .from(collectedEventSignups).innerJoin(users, eq(users.id, collectedEventSignups.user_id))
    .where(eq(collectedEventSignups.external_id, s.collectedExternalId(slug))),
});

/** Профили организаторов собранных событий. `user_id` появляется, когда человек вошёл в сервис. */
export const listHosts = (db: Db) =>
  db.select({ telegram_id: hosts.telegram_id, username: hosts.username, name: hosts.name, channel: hosts.channel, summary: hosts.summary, user_id: hosts.user_id })
    .from(hosts).orderBy(asc(hosts.name)).limit(200);
