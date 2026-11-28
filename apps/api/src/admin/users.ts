// Пользователи сервиса и аудитория организаторов (контакты) глазами команды.
import { and, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import type { AdminActivityEntry, AdminActivityList, AdminActivityListInput, AdminContact, AdminUser, AdminUserView, JoinedVia, User, UserUpdateInput } from '@yaswami/core';
import { normalUsername } from '@yaswami/core';
import type { Ctx } from '../audit.ts';
import { audited } from '../audit.ts';
import { revokeTokens, telegramIdOf } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { collectedEventSignups, contacts, conversations, events, guests, practiceSignups, userActivity, userIdentities, users } from '../db/schema.ts';
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

/** Сколько раз человек записывался: ответы на события Ясвами, записи на собранные события и на услуги. */
const registrations = sql<number>`(
  (select count(*) from ${guests} where ${guests.user_id} = ${users.id})
  + (select count(*) from ${collectedEventSignups} where ${collectedEventSignups.user_id} = ${users.id})
  + (select count(*) from ${practiceSignups} where ${practiceSignups.user_id} = ${users.id})
)::int`;

/** Когда пришёл: строка прихода, а нет её (пришёл между миграцией и выкладкой) — первый способ входа; нет и его — null. */
const joinedAt = sql<Date | null>`coalesce(${userActivity.created_at}, (select min(${userIdentities.created_at}) from ${userIdentities} where ${userIdentities.user_id} = ${users.id}))`.mapWith(userActivity.created_at);

/** Пользователь с приходом (user_activity) и числом записей. */
const userRows = (db: Db) => db
  .select({
    user: users,
    created_at: joinedAt,
    joined_via: userActivity.joined_via,
    start_param: userActivity.start_param,
    last_seen_at: userActivity.last_seen_at,
    registrations,
  })
  .from(users).leftJoin(userActivity, eq(userActivity.user_id, users.id));
type UserRow = Awaited<ReturnType<typeof userRows>>[number];

/** Пользователи для команды: к каждому — Telegram id и способы входа из user_identities (ADR-0008), приход и записи. */
async function withIdentities(db: Db, list: UserRow[]): Promise<AdminUser[]> {
  const rows = list.length ? await db.select().from(userIdentities).where(inArray(userIdentities.user_id, list.map((r) => r.user.id))) : [];
  return list.map(({ user: u, ...activity }) => {
    const mine = rows.filter((r) => r.user_id === u.id);
    const telegram = mine.find((r) => r.provider === 'telegram');
    return { ...u, telegram_id: telegram ? Number(telegram.subject) : null, identities: mine.map((r) => r.provider), ...activity };
  });
}

/** Люди, которые пользовались сервисом, по части имени или @username; без запроса — 50 пришедших последними. */
export const searchUsers = async (db: Db, query?: string): Promise<AdminUser[]> =>
  withIdentities(db, await userRows(db)
    .where(query ? or(ilike(users.first_name, `%${query}%`), ilike(users.username, `%${query.replace(/^@/, '')}%`)) : undefined)
    .orderBy(sql`${joinedAt} desc nulls last`, desc(users.id)).limit(query ? 20 : 50));

export async function getUser(db: Db, id: number): Promise<AdminUserView> {
  const user = await userById(db, id);
  const answers = await db.select({ guest: guests, event_name: events.name }).from(guests).innerJoin(events, eq(events.id, guests.event_id))
    .where(eq(guests.user_id, id)).orderBy(desc(guests.registered_at));
  const signups = await db.select({ external_id: collectedEventSignups.external_id }).from(collectedEventSignups).where(eq(collectedEventSignups.user_id, id));
  return {
    user: (await withIdentities(db, await userRows(db).where(eq(users.id, user.id))))[0]!,
    events: await db.select().from(events).where(eq(events.user_id, id)).orderBy(desc(events.start_at)),
    guests: answers.map((r) => ({ ...r.guest, event_name: r.event_name })),
    collected_signups: signups.map((r) => s.collectedSlug(r.external_id)),
  };
}

export const updateUser = (db: Db, ctx: Ctx, id: number, input: UserUpdateInput): Promise<User> =>
  audited(db, ctx, { action: 'admin_users_update', entity: 'user', id: String(id), input }, async (tx) => {
    const { is_banned, ...rest } = input;
    const current = await userById(tx, id);
    // Повторный бан не сдвигает время первого: по нему видно, с какого дня человек забанен.
    const ban = is_banned === undefined || is_banned === !!current.banned_at ? {} : { banned_at: is_banned ? new Date() : null };
    const values = { ...rest, ...ban, ...(input.username !== undefined ? { username: normalUsername(input.username) } : {}) };
    if (!Object.keys(values).length) return current;
    const [user] = await tx.update(users).set(values).where(eq(users.id, id)).returning();
    // Забаненный больше не ждёт нас: его диалог с ботом прячется из «Людей», как скрытый вручную.
    if (ban.banned_at) await hideBotConversation(tx, id);
    return user!;
  });

/** Прячет диалог человека с ботом (его Telegram — через user_identities, ADR-0008). */
async function hideBotConversation(db: Db, userId: number): Promise<void> {
  const telegramId = await telegramIdOf(db, userId);
  if (telegramId === null) return;
  await db.update(conversations).set({ hidden_at: new Date(), attention: null })
    .where(and(eq(conversations.channel, 'bot'), eq(conversations.peer_id, telegramId)));
}

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

/**
 * Лента активности, новые сверху: кто пришёл, кто куда записался и какие события открывал. Пять источников сводятся
 * в один поток; страница — по времени последней строки (`next_cursor`). Строки с одной и той же секундой на стыке страниц
 * могут не попасть — для ленты, которую читают глазами, это приемлемо.
 */
export async function listActivity(db: Db, input: AdminActivityListInput): Promise<AdminActivityList> {
  const limit = input.pagination_limit ?? 50;
  const want = (t: NonNullable<AdminActivityListInput['type']>) => !input.type || input.type === t;
  // Колонки каждой части: тип, время, кто, сущность и id цели, её название, откуда пришёл, ссылка входа, кто позвал.
  const parts = [
    want('user_joined') && sql`select 'user_joined', a.created_at, a.user_id, null, null, null, a.joined_via, a.start_param, null::bigint
      from user_activity a`,
    want('signup') && sql`select 'guest_registered', g.registered_at, g.user_id, 'event', e.id, e.name, null, null, null::bigint
      from guests g join events e on e.id = g.event_id`,
    want('signup') && sql`select 'collected_signup', c.created_at, c.user_id, 'collected_event', c.external_id, ce.event->>'title', null, null, null
      from collected_event_signups c join collected_events ce on ce.external_id = c.external_id`,
    want('signup') && sql`select 'practice_signup', p.created_at, p.user_id, 'host', p.host_id::text, pr.title, null, null, null
      from practice_signups p join practices pr on pr.id = p.practice_id`,
    want('visit') && sql`select 'visit', v.created_at, v.user_id,
        case when v.event_id is null then 'collected_event' else 'event' end, coalesce(v.event_id, v.collected_external_id),
        coalesce(e.name, ce.event->>'title'), null, null, v.referrer_id
      from visits v left join events e on e.id = v.event_id left join collected_events ce on ce.external_id = v.collected_external_id`,
  ].filter((p) => p !== false);
  // Имена колонок — у подзапроса: первой в объединении может оказаться любая часть, а Postgres берёт имена из первой.
  const rows = await db.execute<{
    type: AdminActivityEntry['type']; created_at: Date | string; user_id: string | number; entity: string | null; target_id: string | null;
    target_name: string | null; joined_via: JoinedVia | null; start_param: string | null; referrer_id: string | number | null;
  }>(sql`select * from (${sql.join(parts, sql` union all `)}) x(type, created_at, user_id, entity, target_id, target_name, joined_via, start_param, referrer_id)
    where ${input.user_id ? sql`x.user_id = ${input.user_id}` : sql`true`}
      and ${input.pagination_cursor ? sql`x.created_at < ${input.pagination_cursor}::timestamptz` : sql`true`}
    order by x.created_at desc limit ${limit + 1}`);
  const page = [...rows].slice(0, limit);
  const ids = [...new Set(page.flatMap((r) => [Number(r.user_id), ...(r.referrer_id ? [Number(r.referrer_id)] : [])]))];
  const people = new Map((ids.length ? await db.select({ id: users.id, first_name: users.first_name, username: users.username }).from(users).where(inArray(users.id, ids)) : [])
    .map((u) => [u.id, u]));
  const entries = page.map((r): AdminActivityEntry => {
    const user = people.get(Number(r.user_id)) ?? { id: Number(r.user_id), first_name: 'Удалённый пользователь', username: null };
    const referrer = r.referrer_id ? people.get(Number(r.referrer_id)) : undefined;
    const entity = r.entity as NonNullable<AdminActivityEntry['target']>['entity'] | null;
    return {
      type: r.type,
      created_at: new Date(r.created_at),
      user,
      target: entity && r.target_id
        ? { entity, id: entity === 'collected_event' ? s.collectedSlug(r.target_id) : r.target_id, name: r.target_name ?? r.target_id }
        : null,
      joined_via: r.joined_via,
      start_param: r.start_param,
      referrer: referrer ? { id: referrer.id, first_name: referrer.first_name } : null,
    };
  });
  const last = entries.at(-1);
  return { entries, has_more: rows.length > limit, next_cursor: rows.length > limit && last ? last.created_at.toISOString() : null };
}
