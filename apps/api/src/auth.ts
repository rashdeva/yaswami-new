// Способы войти: initData мини-приложения Telegram и токен доступа — в заголовке (REST и MCP вне Telegram)
// или в cookie сайта (её ставит вход через Telegram в web-login.ts).
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { User } from '@yaswami/core';
import { dropHostPitch } from './inbox.ts';
import type { Db } from './db/client.ts';
import { apiTokens, hosts, users } from './db/schema.ts';
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

/** Создаёт пользователя при первом входе и обновляет имя при следующих. */
export async function upsertUser(db: Db, tg: TelegramUser): Promise<User> {
  const profile = { first_name: tg.first_name, username: tg.username ?? null };
  const [user] = await db
    .insert(users)
    .values({ id: tg.id, ...profile, lang: tg.language_code ?? 'ru', timezone: 'UTC' })
    .onConflictDoUpdate({ target: users.id, set: profile })
    .returning();
  // Вошёл организатор, чей профиль уже собран по анонсам: привязываем профиль к нему.
  // ponytail: запрос на каждый вход; если станет заметно — привязывать только при создании пользователя.
  const linked = await db.update(hosts).set({ user_id: user!.id }).where(and(eq(hosts.telegram_id, tg.id), isNull(hosts.user_id))).returning({ id: hosts.id });
  // Организатор вошёл — агент для организаторов своего добился: уговаривать его больше нечего.
  if (linked.length) await dropHostPitch(db, tg.id);
  // Аватар сохраняем в фоне: вход не ждёт загрузки картинки.
  void saveUserPhoto(db, user!.id);
  return user!;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Новый токен пользователя. Возвращается один раз; в базе остаётся только хэш. */
export async function issueToken(db: Db, userId: number): Promise<string> {
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
  await db.insert(apiTokens).values({ token_hash: hashToken(token), user_id: userId });
  return token;
}

export const revokeToken = (db: Db, token: string) => db.delete(apiTokens).where(eq(apiTokens.token_hash, hashToken(token)));
export const revokeTokens = (db: Db, userId: number) => db.delete(apiTokens).where(eq(apiTokens.user_id, userId));

async function userByToken(db: Db, token: string): Promise<User | null> {
  const [row] = await db
    .select({ user: users })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.user_id))
    .where(eq(apiTokens.token_hash, hashToken(token)));
  return row?.user ?? null;
}

export type AuthMethod = 'telegram' | 'token';

/** Заголовок `Authorization: tma <initData>` или `Authorization: Bearer <токен>`; без заголовка — токен из cookie сайта. */
export async function authenticate(
  db: Db, botToken: string, header: string | undefined, cookieToken?: string,
): Promise<{ user: User; method: AuthMethod } | null> {
  const [scheme, value] = (header ?? (cookieToken ? `Bearer ${cookieToken}` : '')).split(/\s+(.*)/s);
  if (!value) return null;
  if (scheme === 'tma') {
    // Без токена бота подпись проверить нечем: вход через Telegram закрыт, а не открыт для всех.
    const tg = botToken ? verifyInitData(value, botToken) : null;
    return tg ? { user: await upsertUser(db, tg), method: 'telegram' } : null;
  }
  if (scheme?.toLowerCase() === 'bearer' && value.startsWith(TOKEN_PREFIX)) {
    const user = await userByToken(db, value);
    return user ? { user, method: 'token' } : null;
  }
  return null;
}
