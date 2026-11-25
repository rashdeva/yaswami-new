// Вход на сайте и в приложении через Telegram (OpenID Connect, https://core.telegram.org/bots/telegram-login):
// /auth/telegram/login → oauth.telegram.org → /auth/telegram/callback → cookie с токеном доступа, а для приложения
// (`?app=1`) — переход на app.yaswami://auth?token=… . Вход через Apple (/auth/apple) — только в приложении.
// Любой вход — строка в user_identities: telegram, apple или google (ADR-0008); users.id — свой, не Telegram id.
// Другие способы входа (телефон, почта) добавляются так же: свой /auth/<способ>/…, в конце — signInWith.
// ponytail: один человек, вошедший через Telegram и через Apple или Google, — пока два пользователя. Связать —
// экран «Привязать Telegram» у вошедшего: новая строка ('telegram', id) в user_identities к его пользователю, данные
// никуда не переезжают. Слияние двух уже наполненных аккаунтов — только руками, через команду.
import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';
import type { JsonWebKey, KeyObject } from 'node:crypto';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { AppleLoginInput, GoogleLoginInput } from '@yaswami/core';
import { issueToken, revokeToken, signInWith, upsertUser } from './auth.ts';
import type { Db } from './db/client.ts';
import { settings } from './settings.ts';

export const ISSUER = 'https://oauth.telegram.org';
export const SESSION_COOKIE = 'ysw_session';
const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;
/** Токен мобильного приложения: живёт дольше сессии сайта — входить в приложение заново раз в месяц никто не станет. */
const APP_SESSION_MAX_AGE_S = 180 * 24 * 60 * 60;
/**
 * Куда вернуть вход в приложение. Приложение открывает вход в ASWebAuthenticationSession / Custom Tabs и ждёт эту схему.
 * ponytail: на Android схему может перехватить чужое приложение; закрыть — App Links (https-адрес вместо схемы).
 */
const APP_RETURN = 'app.yaswami://auth';
export const APPLE_ISSUER = 'https://appleid.apple.com';
// Google подписывает id_token с любым из двух вариантов издателя.
export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
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
// Ключи подписи Telegram, Apple и Google меняются редко: держим час, а не скачиваем на каждый вход. Подпись не сошлась —
// ключи могли смениться: скачиваем заново, но не чаще раза в минуту, иначе поддельные токены превращались бы в запросы к ним.
const KEYS_TTL_MS = 3_600_000;
const KEYS_REFETCH_MS = 60_000;
const keyCache = new Map<string, { at: number; keys: Jwk[] }>();
/** Для тестов: забыть скачанные ключи. */
export const forgetKeys = () => keyCache.clear();
async function fetchKeys(url: string): Promise<Jwk[]> {
  const { keys } = (await (await fetch(url, { signal: AbortSignal.timeout(10_000) })).json()) as { keys: Jwk[] };
  keyCache.set(url, { at: Date.now(), keys });
  return keys;
}
async function withKeys<T>(url: string, verify: (keys: Jwk[]) => T): Promise<T> {
  const hit = keyCache.get(url);
  if (!hit || Date.now() - hit.at > KEYS_TTL_MS) return verify(await fetchKeys(url));
  try {
    return verify(hit.keys);
  } catch (e) {
    if (Date.now() - hit.at < KEYS_REFETCH_MS) throw e;
    return verify(await fetchKeys(url));
  }
}

export function verifyIdToken(token: string, jwks: Jwk[], clientId: string | string[], now = Date.now() / 1000, issuer: string | string[] = ISSUER): Record<string, unknown> {
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) throw new Error('id_token is not a JWT');
  const head = JSON.parse(Buffer.from(h, 'base64url').toString()) as { alg: string; kid?: string };
  const check = ALGS[head.alg];
  if (!check) throw new Error(`unsupported alg ${head.alg}`);
  const jwk = jwks.find((k) => (head.kid ? k.kid === head.kid : true) && (!k.alg || k.alg === head.alg));
  if (!jwk) throw new Error('no key for id_token');
  if (!check(Buffer.from(`${h}.${p}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(s, 'base64url'))) throw new Error('bad signature');
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString()) as Record<string, unknown>;
  if (![issuer].flat().includes(String(claims.iss))) throw new Error('wrong issuer');
  if (!([] as unknown[]).concat(claims.aud).map(String).some((aud) => [clientId].flat().includes(aud))) throw new Error('wrong audience');
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
  // Ошибки — простым текстом: в них попадают строки от Telegram и из адреса. Приложению — кодом в его схеме.
  const fail = (c: Context, status: 400 | 401 | 502 | 503, code: string, message: string, app = false) =>
    app ? c.redirect(`${APP_RETURN}?error=${code}`) : c.text(`Вход не удался: ${message}\n\nВернуться: ${publicUrl}/`, status);

  /** Общий конец любого способа входа: токен доступа в cookie, которую скрипты страницы не видят. */
  async function startSession(c: Context, userId: number) {
    setCookie(c, SESSION_COOKIE, await issueToken(db, userId, { ttlS: SESSION_MAX_AGE_S }), { ...cookie, maxAge: SESSION_MAX_AGE_S });
  }

  return new Hono()
    .get('/telegram/login', (c) => {
      const app = c.req.query('app') === '1';
      if (!clientSecret || !clientId) return fail(c, 503, 'not_configured', 'вход через Telegram на сервере не настроен', app);
      const state = randomBytes(16).toString('base64url');
      const verifier = randomBytes(32).toString('base64url');
      const query = new URLSearchParams({
        client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid profile', state,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
      });
      // state и PKCE-verifier ждут возврата в подписанной cookie: серверу не нужно хранить незавершённые входы.
      // `start` — ссылка, с которой человек пришёл на сайт (?startapp=…, метка -s<…>): станет его приходом, если он новый.
      // Только знаки, которые Telegram пускает в startapp; остальное — не наша ссылка, отбрасываем.
      const start = /^[\w-]{1,64}$/.test(c.req.query('start') ?? '') ? c.req.query('start') : undefined;
      const pending = { state, verifier, back: safeReturn(c.req.query('return')), app, start, exp: Date.now() / 1000 + PENDING_MAX_AGE_S };
      setCookie(c, PENDING_COOKIE, seal(pending, key), { ...cookie, maxAge: PENDING_MAX_AGE_S });
      return c.redirect(`${ISSUER}/auth?${String(query).replace(/\+/g, '%20')}`);
    })
    .get('/telegram/callback', async (c) => {
      const pending = unseal<{ state: string; verifier: string; back: string; app?: boolean; start?: string; exp: number }>(getCookie(c, PENDING_COOKIE), key);
      deleteCookie(c, PENDING_COOKIE, cookie);
      const app = !!pending?.app;
      if (c.req.query('error')) return fail(c, 400, 'cancelled', 'вы отменили вход или Telegram его отклонил', app);
      const code = c.req.query('code');
      if (!pending || pending.exp < Date.now() / 1000 || !code || pending.state !== c.req.query('state')) {
        return fail(c, 400, 'expired', 'запрос устарел или начат в другом браузере — попробуйте ещё раз', app);
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
        return fail(c, 502, 'telegram_failed', 'Telegram не подтвердил вход', app);
      }
      let claims: Record<string, unknown>;
      try {
        claims = await withKeys(`${ISSUER}/.well-known/jwks.json`, (keys) => verifyIdToken(body.id_token!, keys, clientId));
      } catch (e) {
        console.error('web login: id_token rejected:', (e as Error).message);
        return fail(c, 401, 'invalid_token', 'ответ Telegram не прошёл проверку', app);
      }
      const id = Number(claims.id ?? claims.sub);
      if (!Number.isSafeInteger(id) || id <= 0) return fail(c, 401, 'invalid_token', 'Telegram не сообщил, кто вы', app);
      const username = typeof claims.preferred_username === 'string' ? claims.preferred_username : undefined;
      const user = await upsertUser(db, { id, first_name: String(claims.name || username || 'Гость').slice(0, 60), username }, { joined_via: app ? 'mobile_app' : 'site', start_param: pending.start });
      if (app) return c.redirect(`${APP_RETURN}?token=${await issueToken(db, user.id, { ttlS: APP_SESSION_MAX_AGE_S })}`);
      await startSession(c, user.id);
      return c.redirect(pending.back);
    })
    // Вход через Apple в приложении (App Store требует его рядом со входом через Telegram, правило 4.8): приложение
    // само получает id_token от Apple и меняет его на наш токен. Имя Apple отдаёт приложению только при первом входе.
    // ponytail: nonce не проверяем — от повтора защищает короткий срок id_token (10 минут); проверка — если приложение
    // начнёт передавать nonce.
    .post('/apple', async (c) => {
      const { id_token, first_name } = AppleLoginInput.parse(await c.req.json());
      let sub: unknown;
      try {
        sub = (await withKeys(`${APPLE_ISSUER}/auth/keys`, (keys) => verifyIdToken(id_token, keys, settings.appleBundleId, undefined, APPLE_ISSUER))).sub;
      } catch (e) {
        console.error('apple login: id_token rejected:', (e as Error).message);
        return c.json({ error: 'invalid_token' }, 401);
      }
      if (typeof sub !== 'string' || !sub) return c.json({ error: 'invalid_token' }, 401);
      const user = await signInWith(db, 'apple', sub, { first_name }, { joined_via: 'mobile_app' });
      return c.json({ token: await issueToken(db, user.id, { ttlS: APP_SESSION_MAX_AGE_S }) });
    })
    // Вход через Google в приложении на Android — так же, как через Apple: приложение меняет id_token Google на наш токен.
    .post('/google', async (c) => {
      const { id_token } = GoogleLoginInput.parse(await c.req.json());
      if (!settings.googleClientIds.length) return c.json({ error: 'not_configured' }, 503);
      let claims: Record<string, unknown>;
      try {
        claims = await withKeys('https://www.googleapis.com/oauth2/v3/certs', (keys) => verifyIdToken(id_token, keys, settings.googleClientIds, undefined, GOOGLE_ISSUERS));
      } catch (e) {
        console.error('google login: id_token rejected:', (e as Error).message);
        return c.json({ error: 'invalid_token' }, 401);
      }
      if (typeof claims.sub !== 'string' || !claims.sub) return c.json({ error: 'invalid_token' }, 401);
      const name = String(claims.given_name || claims.name || '').trim().slice(0, 60) || undefined;
      const user = await signInWith(db, 'google', claims.sub, { first_name: name }, { joined_via: 'mobile_app' });
      return c.json({ token: await issueToken(db, user.id, { ttlS: APP_SESSION_MAX_AGE_S }) });
    })
    .post('/logout', async (c) => {
      const token = getCookie(c, SESSION_COOKIE);
      if (token) await revokeToken(db, token);
      deleteCookie(c, SESSION_COOKIE, cookie);
      return c.body(null, 204);
    });
}
