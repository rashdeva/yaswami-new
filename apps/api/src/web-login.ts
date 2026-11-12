// Вход на сайте через Telegram (OpenID Connect, https://core.telegram.org/bots/telegram-login):
// /auth/telegram/login → oauth.telegram.org → /auth/telegram/callback → cookie с токеном доступа.
// Другие способы входа (телефон, почта) добавляются так же: свой /auth/<способ>/…, в конце — startSession.
// ponytail: пользователь пока опознаётся по id в Telegram (users.id). Для входа без Telegram понадобится
// собственный id пользователя и таблица привязанных способов входа.
import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';
import type { JsonWebKey, KeyObject } from 'node:crypto';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { issueToken, revokeToken, upsertUser } from './auth.ts';
import type { Db } from './db/client.ts';

export const ISSUER = 'https://oauth.telegram.org';
export const SESSION_COOKIE = 'ysw_session';
const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;
const PENDING_COOKIE = 'ysw_login';
const PENDING_MAX_AGE_S = 600;

type Jwk = JsonWebKey & { kid?: string; alg?: string };
// По умолчанию Telegram подписывает RS256; в @BotFather можно выбрать ES256 или EdDSA.
const ALGS: Record<string, (data: Buffer, key: KeyObject, sig: Buffer) => boolean> = {
  RS256: (data, key, sig) => verify('sha256', data, key, sig),
  ES256: (data, key, sig) => verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, sig),
  EdDSA: (data, key, sig) => verify(null, data, key, sig),
};

/** Проверяет id_token и возвращает его содержимое; бросает ошибку, если токен чужой, просрочен или подделан. */
export function verifyIdToken(token: string, jwks: Jwk[], clientId: string, now = Date.now() / 1000): Record<string, unknown> {
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) throw new Error('id_token is not a JWT');
  const head = JSON.parse(Buffer.from(h, 'base64url').toString()) as { alg: string; kid?: string };
  const check = ALGS[head.alg];
  if (!check) throw new Error(`unsupported alg ${head.alg}`);
  const jwk = jwks.find((k) => (head.kid ? k.kid === head.kid : true) && (!k.alg || k.alg === head.alg));
  if (!jwk) throw new Error('no key for id_token');
  if (!check(Buffer.from(`${h}.${p}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(s, 'base64url'))) throw new Error('bad signature');
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString()) as Record<string, unknown>;
  if (claims.iss !== ISSUER) throw new Error('wrong issuer');
  if (!([] as unknown[]).concat(claims.aud).map(String).includes(clientId)) throw new Error('wrong audience');
  if (!(Number(claims.exp) > now)) throw new Error('expired');
  return claims;
}

// Подписанное значение для cookie: <данные>.<hmac>. Браузер видит данные, но подделать их не может.
const seal = (obj: object, key: Buffer) => {
  const body = Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`;
};
function unseal<T>(value: string | undefined, key: Buffer): T | null {
  const [body, mac] = (value ?? '').split('.');
  if (!body || !mac) return null;
  const a = Buffer.from(mac);
  const b = Buffer.from(createHmac('sha256', key).update(body).digest('base64url'));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString()) as T;
  } catch {
    return null;
  }
}

/**
 * Куда вернуть человека после входа: только путь на этом же сайте. Разбираем адрес так же, как браузер: он выбрасывает
 * табуляцию и переводы строк и читает «\» как «/», поэтому «/<таб>/evil.test» для него — чужой сайт.
 */
export function safeReturn(value: string | undefined): string {
  const url = value?.startsWith('/') ? URL.parse(value, 'http://site') : null;
  return url?.origin === 'http://site' ? url.pathname + url.search + url.hash : '/';
}

interface Options {
  db: Db;
  botToken: string;
  clientSecret: string;
  publicUrl: string; // адрес сайта без косой черты в конце; API живёт под <адрес>/api
}

export function webLogin({ db, botToken, clientSecret, publicUrl }: Options) {
  const clientId = botToken.split(':')[0] ?? '';
  const redirectUri = `${publicUrl}/api/auth/telegram/callback`;
  const key = createHmac('sha256', botToken).update('yaswami-web-login').digest();
  const cookie = { path: '/', httpOnly: true, sameSite: 'Lax', secure: publicUrl.startsWith('https:') } as const;
  // Ошибки — простым текстом: в них попадают строки от Telegram и из адреса.
  const fail = (c: Context, status: 400 | 401 | 502 | 503, message: string) => c.text(`Вход не удался: ${message}\n\nВернуться: ${publicUrl}/`, status);

  /** Общий конец любого способа входа: токен доступа в cookie, которую скрипты страницы не видят. */
  async function startSession(c: Context, userId: number) {
    setCookie(c, SESSION_COOKIE, await issueToken(db, userId, { ttlS: SESSION_MAX_AGE_S }), { ...cookie, maxAge: SESSION_MAX_AGE_S });
  }

  return new Hono()
    .get('/telegram/login', (c) => {
      if (!clientSecret || !clientId) return fail(c, 503, 'вход через Telegram на сервере не настроен');
      const state = randomBytes(16).toString('base64url');
      const verifier = randomBytes(32).toString('base64url');
      const query = new URLSearchParams({
        client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid profile', state,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
      });
      // state и PKCE-verifier ждут возврата в подписанной cookie: серверу не нужно хранить незавершённые входы.
      const pending = { state, verifier, back: safeReturn(c.req.query('return')), exp: Date.now() / 1000 + PENDING_MAX_AGE_S };
      setCookie(c, PENDING_COOKIE, seal(pending, key), { ...cookie, maxAge: PENDING_MAX_AGE_S });
      return c.redirect(`${ISSUER}/auth?${String(query).replace(/\+/g, '%20')}`);
    })
    .get('/telegram/callback', async (c) => {
      const pending = unseal<{ state: string; verifier: string; back: string; exp: number }>(getCookie(c, PENDING_COOKIE), key);
      deleteCookie(c, PENDING_COOKIE, cookie);
      if (c.req.query('error')) return fail(c, 400, 'вы отменили вход или Telegram его отклонил');
      const code = c.req.query('code');
      if (!pending || pending.exp < Date.now() / 1000 || !code || pending.state !== c.req.query('state')) {
        return fail(c, 400, 'запрос устарел или начат в другом браузере — попробуйте ещё раз');
      }
      const res = await fetch(`${ISSUER}/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}` },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, code_verifier: pending.verifier }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await res.json().catch(() => ({}))) as { id_token?: string };
      if (!body.id_token) {
        console.error(`web login: token endpoint answered ${res.status}`);
        return fail(c, 502, 'Telegram не подтвердил вход');
      }
      let claims: Record<string, unknown>;
      try {
        const { keys } = (await (await fetch(`${ISSUER}/.well-known/jwks.json`, { signal: AbortSignal.timeout(10_000) })).json()) as { keys: Jwk[] };
        claims = verifyIdToken(body.id_token, keys, clientId);
      } catch (e) {
        console.error('web login: id_token rejected:', (e as Error).message);
        return fail(c, 401, 'ответ Telegram не прошёл проверку');
      }
      const id = Number(claims.id ?? claims.sub);
      if (!Number.isSafeInteger(id) || id <= 0) return fail(c, 401, 'Telegram не сообщил, кто вы');
      const username = typeof claims.preferred_username === 'string' ? claims.preferred_username : undefined;
      const user = await upsertUser(db, { id, first_name: String(claims.name || username || 'Гость').slice(0, 60), username });
      await startSession(c, user.id);
      return c.redirect(pending.back);
    })
    .post('/logout', async (c) => {
      const token = getCookie(c, SESSION_COOKIE);
      if (token) await revokeToken(db, token);
      deleteCookie(c, SESSION_COOKIE, cookie);
      return c.body(null, 204);
    });
}
