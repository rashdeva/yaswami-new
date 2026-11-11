import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { validator } from 'hono/validator';
import * as z from 'zod';
import type { AppConfig, User } from '@yaswami/core';
import { EventCreateInput, EventUpdateInput, RsvpInput, TicketTypeCreateInput, TicketTypeUpdateInput, VisitInput } from '@yaswami/core';
import type { AuthMethod } from './auth.ts';
import { authenticate, issueToken, revokeTokens } from './auth.ts';
import type { Extract } from './bot.ts';
import { handleUpdate } from './bot.ts';
import type { Db } from './db/client.ts';
import { handleMcp } from './mcp.ts';
import { getPhoto } from './photos.ts';
import * as s from './services.ts';
import { settings } from './settings.ts';
import { SESSION_COOKIE, webLogin } from './web-login.ts';

const json = <T extends z.ZodType>(schema: T) => validator('json', (value) => schema.parse(value) as z.infer<T>);

interface Options {
  db: Db;
  botToken: string;
  config?: Partial<Pick<AppConfig, 'bot_username' | 'app_name'>>;
  /** Вход на сайте через Telegram: Client Secret из @BotFather и адрес сайта. Без них вход с сайта выключен. */
  webLogin?: { clientSecret: string; publicUrl: string };
  /** Вебхук бота: секрет, который Telegram присылает в заголовке, и разбор анонсов. Без секрета вебхук закрыт. */
  telegram?: { webhookSecret: string; extract?: Extract };
}

export function createApp({ db, botToken, config, webLogin: login, telegram }: Options) {
  const web_login = !!(botToken && login?.clientSecret);
  return new Hono<{ Variables: { actor: User; method: AuthMethod } }>()
    .onError((e, c) => {
      if (e instanceof s.AppError) return c.json({ error: e.code }, e.status);
      if (e instanceof z.ZodError) return c.json({ error: 'invalid_input', issues: e.issues }, 400);
      if (e instanceof SyntaxError) return c.json({ error: 'invalid_json' }, 400);
      console.error(e);
      return c.json({ error: 'internal' }, 500);
    })
    .get('/health', (c) => c.text('ok'))
    .get('/config', (c) => c.json({ bot_username: null, app_name: 'app', ...config, web_login, city: settings.city, free_events_limit: settings.freeEventsLimit } satisfies AppConfig))
    // До проверки входа: витрину собранных событий видит и анонимный посетитель.
    .get('/collected-events', async (c) => c.json(await s.listCollectedEvents(db)))
    .get('/collected-events/:id', async (c) => c.json(await s.getCollectedEvent(db, c.req.param('id'))))
    // Фото из базы (ADR-0003). Открыто всем: <img> не шлёт заголовок входа, а id фото не угадать.
    .get('/photos/:id', async (c) => {
      const data = await getPhoto(db, c.req.param('id'));
      if (!data) return c.json({ error: 'not_found' }, 404);
      return c.body(new Uint8Array(data), 200, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' });
    })
    .post('/telegram/webhook', async (c) => {
      const secret = Buffer.from(telegram?.webhookSecret ?? '');
      const given = Buffer.from(c.req.header('x-telegram-bot-api-secret-token') ?? '');
      if (!secret.length || given.length !== secret.length || !timingSafeEqual(given, secret)) return c.json({ error: 'forbidden' }, 403);
      const update: unknown = await c.req.json();
      // Отвечаем сразу, разбор идёт следом: ИИ думает секунды, а Telegram при медленном ответе шлёт обновление повторно.
      void handleUpdate(db, telegram?.extract, update).catch(console.error);
      return c.json({ ok: true });
    })
    .route('/auth', webLogin({ db, botToken, clientSecret: login?.clientSecret ?? '', publicUrl: login?.publicUrl ?? '' }))
    .use(async (c, next) => {
      const auth = await authenticate(db, botToken, c.req.header('authorization'), getCookie(c, SESSION_COOKIE));
      if (!auth) return c.json({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': 'Bearer' });
      c.set('actor', auth.user);
      c.set('method', auth.method);
      await next();
    })
    .all('/mcp', (c) => handleMcp(db, c.var.actor, c.req.raw))

    .get('/me', async (c) => c.json(await s.me(db, c.var.actor)))
    .post('/collected-events/:id/claim', async (c) => c.json(await s.claimCollectedEvent(db, c.var.actor, c.req.param('id')), 201))
    .post('/collected-events/:id/signup', async (c) => c.json(await s.signUpForCollectedEvent(db, c.var.actor, c.req.param('id'))))
    .post('/collected-events/:id/visit', json(VisitInput), async (c) => {
      await s.visitCollectedEvent(db, c.var.actor, c.req.param('id'), c.req.valid('json'));
      return c.body(null, 204);
    })

    .get('/contacts', async (c) => c.json(await s.listContacts(db, c.var.actor)))
    .get('/events', async (c) => c.json(await s.listEvents(db, c.var.actor)))
    .post('/events', json(EventCreateInput), async (c) => c.json(await s.createEvent(db, c.var.actor, c.req.valid('json')), 201))
    .get('/events/:id', async (c) => c.json(await s.getEvent(db, c.var.actor, c.req.param('id'))))
    .patch('/events/:id', json(EventUpdateInput), async (c) =>
      c.json(await s.updateEvent(db, c.var.actor, c.req.param('id'), c.req.valid('json'))))
    .post('/events/:id/rsvp', json(RsvpInput), async (c) =>
      c.json(await s.rsvpEvent(db, c.var.actor, c.req.param('id'), c.req.valid('json'))))
    .post('/events/:id/visit', json(VisitInput), async (c) => {
      await s.visitEvent(db, c.var.actor, c.req.param('id'), c.req.valid('json'));
      return c.body(null, 204);
    })

    .post('/events/:id/ticket-types', json(TicketTypeCreateInput), async (c) =>
      c.json(await s.createTicketType(db, c.var.actor, c.req.param('id'), c.req.valid('json')), 201))
    .patch('/ticket-types/:id', json(TicketTypeUpdateInput), async (c) =>
      c.json(await s.updateTicketType(db, c.var.actor, c.req.param('id'), c.req.valid('json'))))
    .delete('/ticket-types/:id', async (c) => {
      await s.deleteTicketType(db, c.var.actor, c.req.param('id'));
      return c.body(null, 204);
    })

    // Выпустить токен можно только из мини-приложения: утёкший токен не должен плодить новые.
    .post('/tokens', async (c) => {
      if (c.var.method !== 'telegram') throw new s.AppError('forbidden', 403);
      return c.json({ token: await issueToken(db, c.var.actor.id) }, 201);
    })
    .delete('/tokens', async (c) => {
      await revokeTokens(db, c.var.actor.id);
      return c.body(null, 204);
    });
}

/** Тип для типизированного клиента на фронте: `hc<App>(url)`. */
export type App = ReturnType<typeof createApp>;
