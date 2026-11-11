import { Hono } from 'hono';
import { validator } from 'hono/validator';
import * as z from 'zod';
import type { User } from '@yaswami/core';
import { EventCreateInput, EventUpdateInput, RsvpInput, TicketTypeCreateInput, TicketTypeUpdateInput } from '@yaswami/core';
import type { AuthMethod } from './auth.ts';
import { authenticate, issueToken, revokeTokens } from './auth.ts';
import type { Db } from './db/client.ts';
import { handleMcp } from './mcp.ts';
import * as s from './services.ts';

const json = <T extends z.ZodType>(schema: T) => validator('json', (value) => schema.parse(value) as z.infer<T>);

export function createApp({ db, botToken }: { db: Db; botToken: string }) {
  return new Hono<{ Variables: { actor: User; method: AuthMethod } }>()
    .onError((e, c) => {
      if (e instanceof s.AppError) return c.json({ error: e.code }, e.status);
      if (e instanceof z.ZodError) return c.json({ error: 'invalid_input', issues: e.issues }, 400);
      if (e instanceof SyntaxError) return c.json({ error: 'invalid_json' }, 400);
      console.error(e);
      return c.json({ error: 'internal' }, 500);
    })
    .get('/health', (c) => c.text('ok'))
    // До проверки входа: витрину собранных событий видит и анонимный посетитель.
    .get('/collected-events', async (c) => c.json(await s.listCollectedEvents(db)))
    .use(async (c, next) => {
      const auth = await authenticate(db, botToken, c.req.header('authorization'));
      if (!auth) return c.json({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': 'Bearer' });
      c.set('actor', auth.user);
      c.set('method', auth.method);
      await next();
    })
    .all('/mcp', (c) => handleMcp(db, c.var.actor, c.req.raw))

    .get('/events', async (c) => c.json(await s.listEvents(db, c.var.actor)))
    .post('/events', json(EventCreateInput), async (c) => c.json(await s.createEvent(db, c.var.actor, c.req.valid('json')), 201))
    .get('/events/:id', async (c) => c.json(await s.getEvent(db, c.var.actor, c.req.param('id'))))
    .patch('/events/:id', json(EventUpdateInput), async (c) =>
      c.json(await s.updateEvent(db, c.var.actor, c.req.param('id'), c.req.valid('json'))))
    .post('/events/:id/rsvp', json(RsvpInput), async (c) =>
      c.json(await s.rsvpEvent(db, c.var.actor, c.req.param('id'), c.req.valid('json'))))

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
