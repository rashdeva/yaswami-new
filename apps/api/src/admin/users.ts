// Пользователи сервиса и аудитория организаторов (контакты) глазами команды.
import { asc, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import type { AdminContact, AdminUserView, User, UserUpdateInput } from '@yaswami/core';
import { normalUsername } from '@yaswami/core';
import type { Ctx } from '../audit.ts';
import { audited } from '../audit.ts';
import { revokeTokens } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { collectedEventSignups, contacts, events, guests, users } from '../db/schema.ts';
import * as s from '../services.ts';
import { verifyTicket } from '../support.ts';

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

/** Люди, которые пользовались сервисом, по части имени или @username; без запроса — первые 50 по имени. */
export const searchUsers = (db: Db, query?: string): Promise<User[]> =>
  db.select().from(users)
    .where(query ? or(ilike(users.first_name, `%${query}%`), ilike(users.username, `%${query.replace(/^@/, '')}%`)) : undefined)
    .orderBy(asc(users.first_name)).limit(query ? 20 : 50);

export async function getUser(db: Db, id: number): Promise<AdminUserView> {
  const user = await userById(db, id);
  const answers = await db.select({ guest: guests, event_name: events.name }).from(guests).innerJoin(events, eq(events.id, guests.event_id))
    .where(eq(guests.user_id, id)).orderBy(desc(guests.registered_at));
  const signups = await db.select({ external_id: collectedEventSignups.external_id }).from(collectedEventSignups).where(eq(collectedEventSignups.user_id, id));
  return {
    user,
    events: await db.select().from(events).where(eq(events.user_id, id)).orderBy(desc(events.start_at)),
    guests: answers.map((r) => ({ ...r.guest, event_name: r.event_name })),
    collected_signups: signups.map((r) => s.collectedSlug(r.external_id)),
  };
}

export const updateUser = (db: Db, ctx: Ctx, id: number, input: UserUpdateInput): Promise<User> =>
  audited(db, ctx, { action: 'admin_users_update', entity: 'user', id: String(id), input }, async (tx) => {
    const values = { ...input, ...(input.username !== undefined ? { username: normalUsername(input.username) } : {}) };
    if (!Object.keys(values).length) return userById(tx, id);
    const [user] = await tx.update(users).set(values).where(eq(users.id, id)).returning();
    if (!user) throw new s.AppError('user_not_found', 404);
    return user;
  });

/**
 * Удалить пользователя: его ответы на события, записи, контакты, отзывы и токены уходят с ним. Организатора — нельзя
 * (`user_has_events`): сначала удалить или передать его события.
 */
export const deleteUser = (db: Db, ctx: Ctx, id: number): Promise<void> =>
  audited(db, ctx, { action: 'admin_users_delete', entity: 'user', id: String(id) }, async (tx) => {
    await userById(tx, id);
    const [hosted] = await tx.select({ n: count() }).from(events).where(eq(events.user_id, id));
    if (hosted!.n > 0) throw new s.AppError('user_has_events', 409);
    // Ответы гостя держат внешний ключ без каскада: убираем их сами и сдвигаем rev событий — счётчики изменились.
    const gone = await tx.delete(guests).where(eq(guests.user_id, id)).returning({ event_id: guests.event_id });
    if (gone.length) await tx.update(events).set({ rev: sql`${events.rev} + 1` }).where(inArray(events.id, gone.map((g) => g.event_id)));
    await tx.delete(users).where(eq(users.id, id));
  });

/** Отозвать все токены пользователя (REST и MCP вне Telegram). Не отменяется: токены в журнал не пишутся. */
export const revokeUserTokens = (db: Db, ctx: Ctx, id: number): Promise<void> =>
  audited(db, ctx, { action: 'admin_users_tokens_revoke', entity: 'user', id: String(id), undoable: false }, async (tx) => {
    await userById(tx, id);
    await revokeTokens(tx, id);
  });

/** Контакты организаторов, новые сверху; `host_user_id` — только одного. */
export const listAnyContacts = (db: Db, hostUserId?: number): Promise<AdminContact[]> =>
  db.select({ id: contacts.id, host_user_id: contacts.host_user_id, user_id: contacts.user_id, first_name: users.first_name, username: users.username, created_at: contacts.created_at })
    .from(contacts).innerJoin(users, eq(users.id, contacts.user_id))
    .where(hostUserId ? eq(contacts.host_user_id, hostUserId) : undefined)
    .orderBy(desc(contacts.created_at)).limit(500); // ponytail: без страниц

/** Убрать человека из аудитории организатора — как `calendars/contacts/remove` в Luma. Новый заход вернёт его. */
export const removeContact = (db: Db, ctx: Ctx, id: string): Promise<void> =>
  audited(db, ctx, { action: 'admin_contacts_remove', entity: 'contact', id }, async (tx) => {
    const gone = await tx.delete(contacts).where(eq(contacts.id, id)).returning({ id: contacts.id });
    if (!gone.length) throw new s.AppError('not_found', 404);
  });
