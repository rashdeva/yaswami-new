// Каталог из анонсов глазами команды: собранные события любого статуса и профили их организаторов (hosts).
import { asc, desc, eq } from 'drizzle-orm';
import type { AdminCollectedEvent, AdminCollectedEventView, AdminHostView, CollectedUpdateInput, Host, HostUpdateInput } from '@yaswami/core';
import { normalUsername } from '@yaswami/core';
import type { Ctx } from '../audit.ts';
import { audited } from '../audit.ts';
import type { Db } from '../db/client.ts';
import { collectedEvents, collectedEventSignups, hosts, photos, users } from '../db/schema.ts';
import { photoUrl } from '../photos.ts';
import * as s from '../services.ts';

/** Собранное событие любого статуса с профилем организатора и теми, кто нажал «Записаться». */
export async function getCollectedEventSignups(db: Db, slug: string): Promise<AdminCollectedEventView> {
  const external_id = s.collectedExternalId(slug);
  const item = await s.getCollectedEvent(db, slug, true);
  const [row] = await db.select({ status: collectedEvents.status, channel: collectedEvents.channel, announcement: collectedEvents.announcement, event: collectedEvents.event })
    .from(collectedEvents).where(eq(collectedEvents.external_id, external_id));
  const signups = await db.select({ id: users.id, first_name: users.first_name, username: users.username, at: collectedEventSignups.created_at })
    .from(collectedEventSignups).innerJoin(users, eq(users.id, collectedEventSignups.user_id))
    .where(eq(collectedEventSignups.external_id, external_id));
  const { telegram_username, whatsapp_phone, url } = row!.event;
  return { ...item, status: row!.status, channel: row!.channel, source_text: row!.announcement.text ?? null, telegram_username, whatsapp_phone, url, signups };
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
export const listHosts = (db: Db): Promise<Host[]> => db.select().from(hosts).orderBy(asc(hosts.name)).limit(300); // ponytail: без страниц

export async function getHost(db: Db, id: string): Promise<AdminHostView> {
  const [host] = await db.select().from(hosts).where(eq(hosts.id, id));
  if (!host) throw new s.AppError('not_found', 404);
  const shots = await db.select({ id: photos.id, source: photos.source }).from(photos).where(eq(photos.host_id, id)).orderBy(desc(photos.created_at));
  return { ...host, photos: shots.map((p) => ({ url: photoUrl(p.id), source_url: p.source.replace(/^telegram:/, 'https://t.me/') })) };
}

export const updateHost = (db: Db, ctx: Ctx, id: string, input: HostUpdateInput): Promise<Host> =>
  audited(db, ctx, { action: 'admin_hosts_update', entity: 'host', id, input }, async (tx) => {
    const values = { ...input, ...(input.username ? { username: normalUsername(input.username) } : {}), ...(input.channel ? { channel: normalUsername(input.channel) } : {}) };
    const [host] = Object.keys(values).length
      ? await tx.update(hosts).set(values).where(eq(hosts.id, id)).returning()
      : await tx.select().from(hosts).where(eq(hosts.id, id));
    if (!host) throw new s.AppError('not_found', 404);
    return host;
  });

/** Удалить профиль с его фото. Сборщик соберёт его заново, если человек снова попадётся в анонсах. */
export const deleteHost = (db: Db, ctx: Ctx, id: string): Promise<void> =>
  audited(db, ctx, { action: 'admin_hosts_delete', entity: 'host', id }, async (tx) => {
    const gone = await tx.delete(hosts).where(eq(hosts.id, id)).returning({ id: hosts.id });
    if (!gone.length) throw new s.AppError('not_found', 404);
  });
