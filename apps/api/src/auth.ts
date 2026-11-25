// Способы войти: initData мини-приложения Telegram и токен доступа — в заголовке (REST и MCP вне Telegram)
// или в cookie сайта (её ставит вход через Telegram в web-login.ts).
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { IdentityProvider as Provider, JoinedVia, User } from '@yaswami/core';
import { dropHostPitch } from './inbox.ts';
import type { Db } from './db/client.ts';
import type { TokenScope } from './db/schema.ts';
import { apiTokens, hosts, userActivity, userIdentities, users } from './db/schema.ts';
import { saveUserPhoto } from './photos.ts';

const INIT_DATA_MAX_AGE_S = 24 * 60 * 60;
const TOKEN_PREFIX = 'ysw_';

export interface TelegramUser {
  id: number;
  first_name: string;
  username?: string;
  language_code?: string;
}

/** Проверка подписи initData по документации Telegram Mini Apps. null — подпись неверна или данные устарели. */
export function verifyInitData(initData: string, botToken: string, now = Date.now()): TelegramUser | null {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dataCheckString = [...params].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  const authDate = Number(params.get('auth_date'));
  if (!authDate || now / 1000 - authDate > INIT_DATA_MAX_AGE_S) return null;
  try {
    const user = JSON.parse(params.get('user') ?? '') as TelegramUser;
    return Number.isSafeInteger(user.id) && typeof user.first_name === 'string' ? user : null;
  } catch {
    return null;
  }
}

/**
 * Вход через Telegram (initData мини-приложения, сайт, приложение, сообщение боту): находит пользователя по способу
 * входа telegram или заводит нового и обновляет имя и username. id пользователя — не Telegram id (ADR-0008).
 */
export async function upsertUser(db: Db, tg: TelegramUser, arrival?: Arrival): Promise<User> {
  const profile = { first_name: tg.first_name, username: tg.username ?? null };
  const found = await signInWith(db, 'telegram', String(tg.id), { ...profile, lang: tg.language_code ?? 'ru' }, arrival);
  const [user] = found.first_name === profile.first_name && found.username === profile.username
    ? [found]
    : await db.update(users).set(profile).where(eq(users.id, found.id)).returning();
  // Вошёл организатор, чей профиль уже собран по анонсам: привязываем профиль к нему.
  // ponytail: запрос на каждый вход; если станет заметно — привязывать только при создании пользователя.
  const linked = await db.update(hosts).set({ user_id: user!.id }).where(and(eq(hosts.telegram_id, tg.id), isNull(hosts.user_id))).returning({ id: hosts.id });
  // Организатор вошёл — агент для организаторов своего добился: уговаривать его больше нечего.
  if (linked.length) await dropHostPitch(db, tg.id);
  // Аватар сохраняем в фоне: вход не ждёт загрузки картинки.
  void saveUserPhoto(db, user!.id, tg.id);
  return user!;
}

/** Откуда человек пришёл (CONTEXT.md, «Приход»): пишется, только когда вход заводит нового пользователя. */
export interface Arrival {
  joined_via: JoinedVia;
  /** startapp мини-приложения или хвост `/start` у бота: событие, кто позвал, метка (`parseStart` в core). */
  start_param?: string | null;
}

/**
 * Любой вход (способ входа, CONTEXT.md): находит пользователя по паре «поставщик, id у поставщика» или заводит нового
 * со случайным id (ADR-0008). Профиль — только при создании: Apple сообщает имя один раз, а Telegram
 * обновляет его сам (upsertUser).
 */
export async function signInWith(
  db: Db, provider: Provider, subject: string, profile: { first_name?: string; username?: string | null; lang?: string } = {}, arrival?: Arrival,
): Promise<User> {
  const find = async () => (await db.select({ user: users }).from(userIdentities).innerJoin(users, eq(users.id, userIdentities.user_id))
    .where(and(eq(userIdentities.provider, provider), eq(userIdentities.subject, subject))))[0]?.user;
  const known = await find();
  if (known) return known;
  try {
    return await db.transaction(async (tx) => {
      const [user] = await tx.insert(users).values({
        first_name: profile.first_name || 'Гость', username: profile.username ?? null, lang: profile.lang ?? 'ru', timezone: 'UTC',
      }).returning();
      await tx.insert(userIdentities).values({ provider, subject, user_id: user!.id });
      const start_param = arrival?.start_param?.slice(0, 128) || null; // Telegram пускает до 64 знаков; длиннее — не от него
      await tx.insert(userActivity).values({ user_id: user!.id, joined_via: arrival?.joined_via ?? null, start_param, last_seen_at: new Date() });
      return user!;
    });
  } catch (e) {
    // Два первых входа одновременно (initData на каждый запрос): второй упирается в уникальность способа входа
    // и берёт пользователя, которого завёл первый. Способа входа нет — значит, случайный id совпал с занятым: ещё раз.
    const raced = (e as { cause?: { code?: string }; code?: string }).cause?.code ?? (e as { code?: string }).code;
    if (raced === '23505') return (await find()) ?? signInWith(db, provider, subject, profile, arrival);
    throw e;
  }
}

/** Пользователь, который входил через этот Telegram; null — такой человек у нас не появлялся. */
export async function userIdByTelegram(db: Db, telegramId: number): Promise<number | null> {
  const [row] = await db.select({ id: userIdentities.user_id }).from(userIdentities)
    .where(and(eq(userIdentities.provider, 'telegram'), eq(userIdentities.subject, String(telegramId))));
  return row?.id ?? null;
}

/**
 * Куда писать человеку в Telegram: его Telegram id. null — вошёл без Telegram, бот ему не напишет.
 * Единственный способ перейти от пользователя к Telegram: users.id — не Telegram id (ADR-0008).
 */
export async function telegramIdOf(db: Db, userId: number): Promise<number | null> {
  return (await telegramIdsOf(db, [userId])).get(userId) ?? null;
}

/** То же для многих: пользователь → Telegram id; кого нет в ответе — тот без Telegram. */
export async function telegramIdsOf(db: Db, userIds: number[]): Promise<Map<number, number>> {
  if (!userIds.length) return new Map();
  const rows = await db.select({ user_id: userIdentities.user_id, subject: userIdentities.subject }).from(userIdentities)
    .where(and(eq(userIdentities.provider, 'telegram'), inArray(userIdentities.user_id, userIds)));
  return new Map(rows.map((r) => [r.user_id, Number(r.subject)]));
}

/** Обратное: Telegram id → пользователь, у кого он есть. */
export async function usersByTelegram(db: Db, telegramIds: number[]): Promise<Map<number, number>> {
  if (!telegramIds.length) return new Map();
  const rows = await db.select({ user_id: userIdentities.user_id, subject: userIdentities.subject }).from(userIdentities)
    .where(and(eq(userIdentities.provider, 'telegram'), inArray(userIdentities.subject, telegramIds.map(String))));
  return new Map(rows.map((r) => [Number(r.subject), r.user_id]));
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Новый токен пользователя. Возвращается один раз; в базе остаётся только хэш. `ttlS` — срок жизни (сессия сайта),
 * `scope` — область действия (токен роли Hermes). Заодно убираем просроченные токены этого человека.
 */
export async function issueToken(db: Db, userId: number, { scope, ttlS }: { scope?: TokenScope; ttlS?: number } = {}): Promise<string> {
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
  await db.delete(apiTokens).where(and(eq(apiTokens.user_id, userId), lt(apiTokens.expires_at, new Date())));
  await db.insert(apiTokens).values({ token_hash: hashToken(token), user_id: userId, scope: scope ?? null, expires_at: ttlS ? new Date(Date.now() + ttlS * 1000) : null });
  return token;
}

export const revokeToken = (db: Db, token: string) => db.delete(apiTokens).where(eq(apiTokens.token_hash, hashToken(token)));
export const revokeTokens = (db: Db, userId: number) => db.delete(apiTokens).where(eq(apiTokens.user_id, userId));

async function userByToken(db: Db, token: string): Promise<{ user: User; scope: TokenScope | null } | undefined> {
  const [row] = await db
    .select({ user: users, scope: apiTokens.scope })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.user_id))
    .where(and(eq(apiTokens.token_hash, hashToken(token)), or(isNull(apiTokens.expires_at), gt(apiTokens.expires_at, new Date()))));
  return row;
}

/** Когда этот процесс последний раз записал заход человека: чаще раза в полчаса базу не трогаем. */
const seen = new Map<number, number>();
const SEEN_EVERY_MS = 30 * 60 * 1000;

/**
 * Отметить заход (`user_activity.last_seen_at`): каждый вход в мини-приложении, на сайте и в приложении и каждое сообщение
 * боту. Не чаще раза в полчаса на процесс; ошибка записи вход не ломает. Строки может не быть — заведётся без прихода.
 */
export async function touchUser(db: Db, userId: number, now = Date.now()): Promise<void> {
  if (now - (seen.get(userId) ?? 0) < SEEN_EVERY_MS) return;
  seen.set(userId, now);
  // ponytail: Map без чистки — по записи на человека, заходившего с запуска процесса; при сотнях тысяч — LRU.
  const at = new Date(now);
  await db.insert(userActivity).values({ user_id: userId, last_seen_at: at })
    .onConflictDoUpdate({ target: userActivity.user_id, set: { last_seen_at: at } })
    .catch((e: unknown) => console.error('touchUser:', (e as Error).message));
}

export type AuthMethod = 'telegram' | 'token';

/** Заголовок `Authorization: tma <initData>` или `Authorization: Bearer <токен>`; без заголовка — токен из cookie сайта. */
export async function authenticate(
  db: Db, botToken: string, header: string | undefined, cookieToken?: string,
): Promise<{ user: User; method: AuthMethod; scope: TokenScope | null; signedAt?: number } | null> {
  const [scheme, value] = (header ?? (cookieToken ? `Bearer ${cookieToken}` : '')).split(/\s+(.*)/s);
  if (!value) return null;
  if (scheme === 'tma') {
    // Без токена бота подпись проверить нечем: вход через Telegram закрыт, а не открыт для всех.
    const tg = botToken ? verifyInitData(value, botToken) : null;
    if (!tg) return null;
    // Подпись проверена — start_param тоже от Telegram: с ним человек открыл мини-приложение.
    const user = await upsertUser(db, tg, { joined_via: 'mini_app', start_param: new URLSearchParams(value).get('start_param') });
    await touchUser(db, user.id);
    // Когда Telegram подписал initData: для выпуска токена нужна свежая подпись (app.ts, POST /tokens).
    return { user, method: 'telegram', scope: null, signedAt: Number(new URLSearchParams(value).get('auth_date')) * 1000 };
  }
  if (scheme?.toLowerCase() === 'bearer' && value.startsWith(TOKEN_PREFIX)) {
    const found = await userByToken(db, value);
    if (!found) return null;
    // Токен роли Hermes (со областью действия) — это агент, а не человек: его запросы заходом не считаем.
    if (!found.scope) await touchUser(db, found.user.id);
    return { ...found, method: 'token' };
  }
  return null;
}
