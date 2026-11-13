// Каталог из анонсов глазами команды: собранные события любого статуса и профили их организаторов (hosts).
import { and, asc, count, desc, eq, notInArray } from 'drizzle-orm';
import type { AdminCollectedEvent, AdminCollectedEventView, AdminHost, AdminHostListItem, AdminHostView, CollectedUpdateInput, HostCreateInput, HostUpdateInput, Practice, PracticeUpdateInput } from '@yaswami/core';
import { normalUsername } from '@yaswami/core';
import type { Ctx } from '../audit.ts';
import { audited } from '../audit.ts';
import type { Db } from '../db/client.ts';
import { collectedEvents, collectedEventSignups, hosts, photos, practices, practiceSignups, users } from '../db/schema.ts';
import { photoUrl } from '../photos.ts';
import * as s from '../services.ts';

/** Собранное событие любого статуса с профилем организатора и теми, кто нажал «Записаться». */
export async function getCollectedEventSignups(db: Db, slug: string): Promise<AdminCollectedEventView> {
  const external_id = s.collectedExternalId(slug);
  const item = await s.getCollectedEvent(db, slug, true);
  const [row] = await db.select({ status: collectedEvents.status, city_id: collectedEvents.city_id, channel: collectedEvents.channel, announcement: collectedEvents.announcement, event: collectedEvents.event, views: collectedEvents.views, reactions: collectedEvents.reactions })
    .from(collectedEvents).where(eq(collectedEvents.external_id, external_id));
  const signups = await db.select({ id: users.id, first_name: users.first_name, username: users.username, at: collectedEventSignups.created_at })
    .from(collectedEventSignups).innerJoin(users, eq(users.id, collectedEventSignups.user_id))
    .where(eq(collectedEventSignups.external_id, external_id));
  const { telegram_username, whatsapp_phone, url } = row!.event;
  return { ...item, status: row!.status, city_id: row!.city_id, channel: row!.channel, source_text: row!.announcement.text ?? null, views: row!.views, reactions: row!.reactions, telegram_username, whatsapp_phone, url, signups };
}

export const updateCollectedEvent = (db: Db, ctx: Ctx, slug: string, input: CollectedUpdateInput): Promise<AdminCollectedEvent> =>
  audited(db, ctx, { action: 'admin_collected_events_update', entity: 'collected_event', id: slug, input }, (tx) => s.updateCollectedEvent(tx, slug, input));

/**
 * Перерисовать обложку и ролик: нарисованная обложка удаляется, обработка сбрасывается, очередь возьмёт событие
 * минут через 20. Отменяется: денег сразу не тратит — пока очередь не взяла событие, отмена вернёт прежние обложку и ролик.
 */
export const redoCollectedCover = (db: Db, ctx: Ctx, slug: string): Promise<void> =>
  audited(db, ctx, { action: 'admin_collected_events_redo', entity: 'collected_event', id: slug }, (tx) => s.redoCollectedCover(tx, slug));

/** Удалить совсем, с обложкой и записавшимися. Повторный анонс создаст событие заново — чтобы не было, отклоняй. */
export const deleteCollectedEvent = (db: Db, ctx: Ctx, slug: string): Promise<void> =>
  audited(db, ctx, { action: 'admin_collected_events_delete', entity: 'collected_event', id: slug }, (tx) => s.deleteCollectedEvent(tx, slug));

export const setCollectedCover = (db: Db, ctx: Ctx, slug: string, imageUrl?: string) =>
  audited(db, ctx, { action: 'admin_covers_set', entity: 'collected_event', id: slug, input: { image_url: imageUrl } }, (tx) => s.setCollectedCover(tx, slug, imageUrl));

/** Заказ ролика не отменяется: генерация платная, деньги уже потрачены. */
export const requestCollectedVideo = (db: Db, ctx: Ctx, slug: string) =>
  audited(db, ctx, { action: 'admin_videos_request', entity: 'collected_event', id: slug, undoable: false }, (tx) => s.requestCollectedVideo(tx, slug));

/** Профили организаторов собранных событий. `user_id` появляется, когда человек вошёл в сервис. */
export async function listHosts(db: Db): Promise<AdminHostListItem[]> {
  const rows = await db.select().from(hosts).orderBy(asc(hosts.name)).limit(300); // ponytail: без страниц
  const offered = await s.practicesByHost(db);
  const counts = await db.select({ host_id: practiceSignups.host_id, practice_id: practiceSignups.practice_id, n: count() }).from(practiceSignups).groupBy(practiceSignups.host_id, practiceSignups.practice_id);
  return rows.map((h) => ({ ...h, practices: offered.get(h.id) ?? [], practice_signup_counts: Object.fromEntries(counts.filter((c) => c.host_id === h.id).map((c) => [c.practice_id, c.n])) }));
}

export async function getHost(db: Db, id: string): Promise<AdminHostView> {
  const [host] = await db.select().from(hosts).where(eq(hosts.id, id));
  if (!host) throw new s.AppError('not_found', 404);
  const shots = await db.select({ id: photos.id, source: photos.source }).from(photos).where(eq(photos.host_id, id)).orderBy(desc(photos.created_at));
  const practice_signups = await db.select({ id: users.id, first_name: users.first_name, username: users.username, practice_id: practices.id, title: practices.title, at: practiceSignups.created_at })
    .from(practiceSignups).innerJoin(users, eq(users.id, practiceSignups.user_id)).innerJoin(practices, eq(practices.id, practiceSignups.practice_id))
    .where(eq(practiceSignups.host_id, id)).orderBy(desc(practiceSignups.created_at));
  return { ...(await withPractices(db, host)), photos: shots.map((p) => ({ url: photoUrl(p.id), source_url: p.source.replace(/^telegram:/, 'https://t.me/') })), practice_signups };
}

const withPractices = async (db: Db, host: typeof hosts.$inferSelect): Promise<AdminHost> =>
  ({ ...host, practices: (await s.practicesByHost(db, host.id)).get(host.id) ?? [] });

/**
 * Добавить организатора по username. Найти человека в Telegram может только сборщик: здесь появляется заготовка
 * без `telegram_id`, сборщик на следующем проходе заполнит её (имя, «о себе», канал, сводка) или отклонит, если под
 * этим username нет ни человека, ни канала.
 */
export const createHost = (db: Db, ctx: Ctx, input: HostCreateInput): Promise<AdminHost> =>
  audited(db, ctx, { action: 'admin_hosts_create', entity: 'host', id: (h) => h.id, input }, async (tx) => {
    const username = input.username.replace(/^(?:https?:\/\/)?(?:t\.me\/|@)?/, '').replace(/\/$/, '').toLowerCase();
    if ((await tx.select({ id: hosts.id }).from(hosts).where(eq(hosts.username, username))).length) throw new s.AppError('host_exists', 409);
    await s.assertCity(tx, input.city_id);
    const [host] = await tx.insert(hosts).values({ username, name: `@${username}`, city_id: input.city_id }).returning();
    return { ...host!, practices: [] };
  });

export const updateHost = (db: Db, ctx: Ctx, id: string, { practices: list, ...input }: HostUpdateInput): Promise<AdminHost> =>
  audited(db, ctx, { action: 'admin_hosts_update', entity: 'host', id, input: { ...input, ...(list ? { practices: list } : {}) } }, async (tx) => {
    await s.assertCity(tx, input.city_id);
    const values = { ...input, ...(input.username ? { username: normalUsername(input.username) } : {}), ...(input.channel ? { channel: normalUsername(input.channel) } : {}) };
    const [host] = Object.keys(values).length
      ? await tx.update(hosts).set(values).where(eq(hosts.id, id)).returning()
      : await tx.select().from(hosts).where(eq(hosts.id, id));
    if (!host) throw new s.AppError('not_found', 404);
    if (list) {
      // Список целиком: чего в нём нет — удаляем (вместе с записями), с `id` — правим на месте, без `id` — добавляем.
      const kept = list.flatMap((p) => p.id ?? []);
      await tx.delete(practices).where(and(eq(practices.host_id, id), kept.length ? notInArray(practices.id, kept) : undefined));
      for (const [position, { id: practiceId, ...fields }] of list.entries()) {
        if (!practiceId) await tx.insert(practices).values({ ...fields, host_id: id, position });
        // Чужой или уже удалённый id ничего не находит: правка молча теряется хуже, чем отказ.
        else if (!(await tx.update(practices).set({ ...fields, position }).where(and(eq(practices.id, practiceId), eq(practices.host_id, id))).returning({ id: practices.id })).length) throw new s.AppError('practice_not_found', 404);
      }
    }
    return withPractices(tx, host);
  });

/**
 * Правка одной Practice: решение модератора или её текст. Отдельно от `updateHost` со списком целиком: два решения
 * подряд по услугам одного мастера не затирают друг друга. В журнале — правка организатора: его снимок включает Practice.
 */
export async function updatePractice(db: Db, ctx: Ctx, id: string, input: PracticeUpdateInput): Promise<Practice> {
  const [found] = /^[0-9a-f-]{36}$/i.test(id) ? await db.select({ host_id: practices.host_id }).from(practices).where(eq(practices.id, id)) : [];
  if (!found) throw new s.AppError('not_found', 404);
  return audited(db, ctx, { action: 'admin_practices_update', entity: 'host', id: found.host_id, input: { practice_id: id, ...input } }, async (tx) => {
    if (Object.keys(input).length) await tx.update(practices).set(input).where(eq(practices.id, id));
    const practice = (await s.practicesByHost(tx, found.host_id)).get(found.host_id)?.find((p) => p.id === id);
    if (!practice) throw new s.AppError('not_found', 404);
    return practice;
  });
}

/** Удалить профиль с его фото. Сборщик соберёт его заново, если человек снова попадётся в анонсах. */
export const deleteHost = (db: Db, ctx: Ctx, id: string): Promise<void> =>
  audited(db, ctx, { action: 'admin_hosts_delete', entity: 'host', id }, async (tx) => {
    const gone = await tx.delete(hosts).where(eq(hosts.id, id)).returning({ id: hosts.id });
    if (!gone.length) throw new s.AppError('not_found', 404);
  });
