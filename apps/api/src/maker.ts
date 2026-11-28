// Мастер сам добавляет свой товар или услугу (products_create, practices_create): пишет боту, роль поддержки разбирает
// сообщение и зовёт person_products_create / person_practices_create, или зовёт REST из приложения. Форм у нас нет:
// мини-приложение отправляет человека в бота (экран «Добавить» в apps/web). Всё добавленное ждёт решения команды
// в «Каталоге» (`pending`), как собранное сборщиком; команда узнаёт о нём сразу.
import { and, eq, gt, isNull, max, sql } from 'drizzle-orm';
import type { PracticeCreateInput, PracticeSubmission, ProductCreateInput, ProductSubmission, User } from '@yaswami/core';
import { OTHER_TOPIC, PRACTICES_PER_DAY, PRODUCTS_PER_DAY, productTitleKey } from '@yaswami/core';
import { telegramIdOf } from './auth.ts';
import type { Db } from './db/client.ts';
import { hosts, practices, products } from './db/schema.ts';
import { alertTeam } from './inbox.ts';
import { AppError, assertCity } from './services.ts';
import { settings } from './settings.ts';

const DAY = 86_400_000;
type HostRow = typeof hosts.$inferSelect;

/**
 * Профиль Host самого человека: тот, что к нему уже привязан, собранный по его Telegram или заготовка команды по его
 * username; нет ни одного — заводится новый (`pending`, как у сборщика). К товару и услуге человек приходит через
 * чат с мастером (`t.me/<username>`), поэтому без username в Telegram добавить нечего: `username_required`.
 */
async function ownHost(db: Db, actor: User, city_id: string | undefined): Promise<HostRow> {
  const [linked] = await db.select().from(hosts).where(eq(hosts.user_id, actor.id));
  if (linked) return linked;
  const telegram_id = await telegramIdOf(db, actor.id);
  if (telegram_id !== null) {
    const [collected] = await db.update(hosts).set({ user_id: actor.id }).where(eq(hosts.telegram_id, telegram_id)).returning();
    if (collected) return collected;
  }
  if (!actor.username) throw new AppError('username_required', 400);
  const username = actor.username.toLowerCase();
  const [draft] = await db.update(hosts).set({ user_id: actor.id, telegram_id })
    .where(and(eq(hosts.username, username), isNull(hosts.telegram_id), isNull(hosts.user_id))).returning();
  if (draft) return draft;
  const city = city_id ?? actor.city_id ?? settings.defaultCityId;
  await assertCity(db, city);
  const [made] = await db.insert(hosts).values({ user_id: actor.id, telegram_id, username, name: actor.first_name, city_id: city }).returning();
  return made!;
}

const hostUrl = (id: string) => `${settings.publicUrl}/hosts/${id}`;
const who = (actor: User) => `${actor.first_name}${actor.username ? ` (@${actor.username})` : ''}`;

/** Добавить свой товар. Тот же товар у мастера (то же название) второй раз не пишется: `product_exists`. */
export async function createProduct(db: Db, actor: User, input: ProductCreateInput): Promise<ProductSubmission> {
  const host = await ownHost(db, actor, input.city_id);
  const [today] = await db.select({ n: sql<number>`count(*)::int` }).from(products)
    .where(and(eq(products.host_id, host.id), gt(products.created_at, new Date(Date.now() - DAY))));
  if (today!.n >= PRODUCTS_PER_DAY) throw new AppError('products_limit', 429);
  const { title, description = null, price = null, unit = null, category } = input;
  // Исходного поста нет: «пост» — чат мастера и то, что он рассказал; по нему команда сверяет товар.
  const announcement = { url: `https://t.me/${host.username}`, text: description ?? title };
  const [row] = await db.insert(products)
    .values({ host_id: host.id, title, description, price, unit, category, announcement, title_key: productTitleKey(title) })
    .onConflictDoNothing().returning();
  if (!row) throw new AppError('product_exists', 409);
  await alertTeam(`${who(actor)} добавляет товар «${title}»\n${settings.publicUrl}/admin/catalog?kind=products`, await telegramIdOf(db, actor.id)).catch(console.error);
  return { id: row.id, title, description, price, unit, category, status: row.status, host_id: host.id, host_url: hostUrl(host.id) };
}

/** Добавить свою услугу — последней в списке мастера. Формат и категорию, если их не дали, разметит сборщик. */
export async function createPractice(db: Db, actor: User, input: PracticeCreateInput): Promise<PracticeSubmission> {
  const host = await ownHost(db, actor, input.city_id);
  const [today] = await db.select({ n: sql<number>`count(*)::int` }).from(practices)
    .where(and(eq(practices.host_id, host.id), gt(practices.created_at, new Date(Date.now() - DAY))));
  if (today!.n >= PRACTICES_PER_DAY) throw new AppError('practices_limit', 429);
  const [last] = await db.select({ position: max(practices.position) }).from(practices).where(eq(practices.host_id, host.id));
  const { title, description = null, price = null, topic = OTHER_TOPIC, category = null, formats = null } = input;
  const [row] = await db.insert(practices)
    .values({ host_id: host.id, title, description, price, topic, category, formats, position: (last?.position ?? -1) + 1 })
    .returning();
  await alertTeam(`${who(actor)} добавляет услугу «${title}»\n${settings.publicUrl}/admin/catalog?kind=services`, await telegramIdOf(db, actor.id)).catch(console.error);
  return { id: row!.id, title, description, price, topic, status: row!.status, host_id: host.id, host_url: hostUrl(host.id) };
}
