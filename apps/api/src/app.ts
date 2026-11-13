import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import { validator } from 'hono/validator';
import * as z from 'zod';
import type { AppConfig, User } from '@yaswami/core';
import {
  AccountCreateInput, AccountLoginInput, AccountMessageInput, AccountTypingInput, AccountUpdateInput, AdminActionListInput, AdminContactListInput, AdminEventCreateInput, AdminEventListInput,
  AdminGuestUpdateInput, CollectedListInput, CollectedUpdateInput, ConversationUpdateInput, CoverSetInput, DraftSendInput, DraftUpdateInput, EventCreateInput,
  EventUpdateInput, HostUpdateInput, InboxSendInput, LeadInput, RsvpInput, SourceCreateInput, SourceUpdateInput, TicketTypeCreateInput, TicketTypeUpdateInput, UserSearchInput, UserUpdateInput, VisitInput,
} from '@yaswami/core';
import * as admin from './admin.ts';
import type { Ctx } from './audit.ts';
import type { AuthMethod } from './auth.ts';
import { authenticate, issueToken, revokeTokens } from './auth.ts';
import { handleUpdate } from './bot.ts';
import type { Db } from './db/client.ts';
import type { TokenScope } from './db/schema.ts';
import {
  adminOverview, createAccount, deleteAccount, inboxFeed, inboxSend, inboxThread, inboxUpdate, listAccounts, logSent, recordAccountMessage, recordAccountTyping, recordLead, rejectDraft,
  requireAdmin, sendDraft, submitAccountLogin, updateAccount, updateDraft,
} from './inbox.ts';
import type { LiveEvent } from './live.ts';
import { live } from './live.ts';
import { handleMcp } from './mcp.ts';
import { getPhoto } from './photos.ts';
import * as s from './services.ts';
import { settings } from './settings.ts';
import { bot } from './telegram.ts';
import { SESSION_COOKIE, webLogin } from './web-login.ts';

const json = <T extends z.ZodType>(schema: T) => validator('json', (value) => schema.parse(value) as z.infer<T>);
const userId = z.coerce.number().int().positive();
const LIVE_PING_MS = 25_000;

interface Options {
  db: Db;
  botToken: string;
  config?: Partial<Pick<AppConfig, 'bot_username' | 'app_name'>>;
  /** Вход на сайте через Telegram: Client Secret из @BotFather и адрес сайта. Без них вход с сайта выключен. */
  webLogin?: { clientSecret: string; publicUrl: string };
  /** Вебхук бота: секрет, который Telegram присылает в заголовке, и разбор анонсов. Без секрета вебхук закрыт. */
  telegram?: { webhookSecret: string };
}

// Самое большое тело — обложка от иллюстратора картинкой прямо в запросе (data URL, до 4 МБ в base64 ≈ 5,4 МБ).
const BODY_MAX = 8 * 1024 * 1024;

// Сколько запросов в минуту делает один вошедший человек или токен: защита от перебора и от раздувания базы.
// ponytail: счётчик в памяти процесса и только для вошедших; второй экземпляр API или наплыв анонимных запросов
// к витрине — считать на прокси (Cloudflare) или в базе.
const hits = new Map<number, { since: number; n: number }>();
function tooMany(userId: number, now = Date.now()): boolean {
  const hit = hits.get(userId);
  if (hit && now - hit.since < 60_000) return ++hit.n > settings.requestsPerMinute;
  if (hits.size > 10_000) hits.clear();
  hits.set(userId, { since: now, n: 1 });
  return false;
}

/** Кто действует в админке — для журнала (audit.ts). */
const ctx = (c: { var: { actor: User } }): Ctx => ({ actor: c.var.actor, via: 'admin' });

export function createApp({ db, botToken, config, webLogin: login, telegram }: Options) {
  const web_login = !!(botToken && login?.clientSecret);
  bot.log = logSent(db);
  return new Hono<{ Variables: { actor: User; method: AuthMethod; scope: TokenScope | null } }>()
    .use(bodyLimit({ maxSize: BODY_MAX, onError: (c) => c.json({ error: 'too_large' }, 413) }))
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
      // Превью Telegram — JPEG, нарисованные обложки — PNG.
      return c.body(new Uint8Array(data), 200, { 'content-type': data[0] === 0x89 ? 'image/png' : 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' });
    })
    .post('/telegram/webhook', async (c) => {
      const secret = Buffer.from(telegram?.webhookSecret ?? '');
      const given = Buffer.from(c.req.header('x-telegram-bot-api-secret-token') ?? '');
      if (!secret.length || given.length !== secret.length || !timingSafeEqual(given, secret)) return c.json({ error: 'forbidden' }, 403);
      const update: unknown = await c.req.json();
      // Отвечаем сразу, ответ идёт следом: ИИ думает секунды, а Telegram при медленном ответе шлёт обновление повторно.
      void handleUpdate(db, update).catch(console.error);
      return c.json({ ok: true });
    })
    // Сборщик сообщает о личных сообщениях на наших аккаунтах Telegram. Без общего секрета вход закрыт.
    .use('/internal/*', async (c, next) => {
      const secret = Buffer.from(settings.collectorSecret);
      const given = Buffer.from(c.req.header('x-collector-secret') ?? '');
      if (!secret.length || given.length !== secret.length || !timingSafeEqual(given, secret)) return c.json({ error: 'forbidden' }, 403);
      await next();
    })
    .post('/internal/account-message', json(AccountMessageInput), async (c) => {
      await recordAccountMessage(db, c.req.valid('json'));
      return c.body(null, 204);
    })
    // Человек набирает сообщение на наш аккаунт: админка покажет «печатает».
    .post('/internal/account-typing', json(AccountTypingInput), async (c) => {
      await recordAccountTyping(db, c.req.valid('json'));
      return c.body(null, 204);
    })
    // Вопрос «куда сходить» из чата: ответ роли занимает секунды, сборщик его не ждёт.
    .post('/internal/lead', json(LeadInput), (c) => {
      void recordLead(db, c.req.valid('json')).catch(console.error);
      return c.body(null, 202);
    })
    .route('/auth', webLogin({ db, botToken, clientSecret: login?.clientSecret ?? '', publicUrl: login?.publicUrl ?? '' }))
    .use(async (c, next) => {
      const auth = await authenticate(db, botToken, c.req.header('authorization'), getCookie(c, SESSION_COOKIE));
      if (!auth) return c.json({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': 'Bearer' });
      if (tooMany(auth.user.id)) return c.json({ error: 'too_many_requests' }, 429, { 'Retry-After': '60' });
      c.set('actor', auth.user);
      c.set('method', auth.method);
      c.set('scope', auth.scope);
      await next();
    })
    .all('/mcp', (c) => handleMcp(db, c.var.actor, c.req.raw, c.var.scope))
    // Токен с областью действия (роль Hermes) — только для MCP: в REST ему нечего делать.
    .use(async (c, next) => {
      if (c.var.scope) throw new s.AppError('forbidden', 403);
      await next();
    })

    .get('/me', async (c) => c.json(await s.me(db, c.var.actor)))
    .get('/me/collected', async (c) => c.json(await s.myCollectedEvents(db, c.var.actor)))
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

    // Админка: только для ADMIN_IDS. Каждое изменение пишется в журнал с тем, кто его сделал (audit.ts).
    .use('/admin/*', async (c, next) => {
      requireAdmin(c.var.actor);
      await next();
    })
    .get('/admin/inbox', async (c) => c.json(await inboxFeed(db, c.var.actor)))
    // Переписка в реальном времени (live.ts): сразу — кто пишет сейчас, дальше — каждое изменение.
    .get('/admin/live', (c) => streamSSE(c, async (stream) => {
      const send = (e: LiveEvent) => void stream.writeSSE({ event: e.event, data: JSON.stringify(e.data) }).catch(() => {});
      send({ event: 'typing', data: live.typing() });
      const off = live.subscribe(send);
      // Прокси Railway рвёт соединение, по которому долго ничего не идёт, — шлём пустой комментарий.
      const ping = setInterval(() => void stream.write(': ping\n\n').catch(() => {}), LIVE_PING_MS);
      await new Promise<void>((resolve) => stream.onAbort(() => {
        clearInterval(ping);
        off();
        resolve();
      }));
    }))
    .get('/admin/overview', async (c) => c.json(await adminOverview(db)))
    .get('/admin/conversations/:id/messages', async (c) => c.json(await inboxThread(db, c.req.param('id'))))
    .post('/admin/conversations/:id/messages', json(InboxSendInput), async (c) => {
      await inboxSend(db, ctx(c), c.req.param('id'), c.req.valid('json').text);
      return c.body(null, 204);
    })
    .patch('/admin/conversations/:id', json(ConversationUpdateInput), async (c) => c.json(await inboxUpdate(db, ctx(c), c.req.param('id'), c.req.valid('json'))))
    .post('/admin/messages/:id/send', json(DraftSendInput), async (c) => {
      await sendDraft(db, ctx(c), c.req.param('id'), c.req.valid('json').text);
      return c.body(null, 204);
    })
    .patch('/admin/messages/:id', json(DraftUpdateInput), async (c) => c.json(await updateDraft(db, ctx(c), c.req.param('id'), c.req.valid('json').text)))
    .delete('/admin/messages/:id', async (c) => {
      await rejectDraft(db, ctx(c), c.req.param('id'));
      return c.body(null, 204);
    })
    .get('/admin/accounts', async (c) => c.json(await listAccounts(db)))
    .post('/admin/accounts', json(AccountCreateInput), async (c) => c.json(await createAccount(db, ctx(c), c.req.valid('json')), 201))
    .patch('/admin/accounts/:id', json(AccountUpdateInput), async (c) => c.json(await updateAccount(db, ctx(c), c.req.param('id'), c.req.valid('json'))))
    .post('/admin/accounts/:id/login', json(AccountLoginInput), async (c) => {
      await submitAccountLogin(db, ctx(c), c.req.param('id'), c.req.valid('json').secret);
      return c.body(null, 204);
    })
    .delete('/admin/accounts/:id', async (c) => {
      await deleteAccount(db, ctx(c), c.req.param('id'));
      return c.body(null, 204);
    })

    // События Ясвами: любое событие, гости, типы билетов, отзывы.
    .get('/admin/events', async (c) => c.json(await admin.listAllEvents(db, AdminEventListInput.parse(c.req.query()))))
    .post('/admin/events', json(AdminEventCreateInput), async (c) => c.json(await admin.createAnyEvent(db, ctx(c), c.req.valid('json')), 201))
    .get('/admin/events/:id', async (c) => c.json(await admin.getAnyEvent(db, c.req.param('id'))))
    .patch('/admin/events/:id', json(EventUpdateInput), async (c) => c.json(await admin.updateAnyEvent(db, ctx(c), c.req.param('id'), c.req.valid('json'))))
    .delete('/admin/events/:id', async (c) => {
      await admin.deleteAnyEvent(db, ctx(c), c.req.param('id'));
      return c.body(null, 204);
    })
    .get('/admin/events/:id/guests', async (c) => c.json(await admin.listAnyGuests(db, c.req.param('id'))))
    .put('/admin/events/:id/guests/:user_id', json(AdminGuestUpdateInput), async (c) =>
      c.json(await admin.updateAnyGuest(db, ctx(c), c.req.param('id'), userId.parse(c.req.param('user_id')), c.req.valid('json'))))
    .delete('/admin/events/:id/guests/:user_id', async (c) => {
      await admin.removeAnyGuest(db, ctx(c), c.req.param('id'), userId.parse(c.req.param('user_id')));
      return c.body(null, 204);
    })
    .post('/admin/events/:id/ticket-types', json(TicketTypeCreateInput), async (c) =>
      c.json(await admin.createAnyTicketType(db, ctx(c), c.req.param('id'), c.req.valid('json')), 201))
    .patch('/admin/ticket-types/:id', json(TicketTypeUpdateInput), async (c) => c.json(await admin.updateAnyTicketType(db, ctx(c), c.req.param('id'), c.req.valid('json'))))
    .delete('/admin/ticket-types/:id', async (c) => {
      await admin.deleteAnyTicketType(db, ctx(c), c.req.param('id'));
      return c.body(null, 204);
    })
    .get('/admin/events/:id/feedback', async (c) => c.json(await admin.listFeedback(db, c.req.param('id'))))
    .delete('/admin/events/:id/feedback/:user_id', async (c) => {
      await admin.deleteFeedback(db, ctx(c), c.req.param('id'), userId.parse(c.req.param('user_id')));
      return c.body(null, 204);
    })

    // Каталог из анонсов: модерация и правка собранных событий (в ленту выходит только опубликованное), обложки, ролики.
    .get('/admin/collected-events', async (c) => c.json(await s.listCollectedForAdmin(db, CollectedListInput.parse(c.req.query()).status)))
    .get('/admin/collected-events/:id', async (c) => c.json(await admin.getCollectedEventSignups(db, c.req.param('id'))))
    .patch('/admin/collected-events/:id', json(CollectedUpdateInput), async (c) => c.json(await admin.updateCollectedEvent(db, ctx(c), c.req.param('id'), c.req.valid('json'))))
    .post('/admin/collected-events/:id/redo', async (c) => {
      await admin.redoCollectedCover(db, ctx(c), c.req.param('id'));
      return c.body(null, 204);
    })
    .delete('/admin/collected-events/:id', async (c) => {
      await admin.deleteCollectedEvent(db, ctx(c), c.req.param('id'));
      return c.body(null, 204);
    })
    .get('/admin/covers', async (c) => c.json(await s.listPendingCovers(db)))
    .post('/admin/covers/:id', json(CoverSetInput), async (c) => c.json(await admin.setCollectedCover(db, ctx(c), c.req.param('id'), c.req.valid('json').image_url)))
    .post('/admin/videos/:id', async (c) => c.json(await admin.requestCollectedVideo(db, ctx(c), c.req.param('id')), 202))
    .get('/admin/hosts', async (c) => c.json(await admin.listHosts(db)))
    .get('/admin/hosts/:id', async (c) => c.json(await admin.getHost(db, c.req.param('id'))))
    .patch('/admin/hosts/:id', json(HostUpdateInput), async (c) => c.json(await admin.updateHost(db, ctx(c), c.req.param('id'), c.req.valid('json'))))
    .delete('/admin/hosts/:id', async (c) => {
      await admin.deleteHost(db, ctx(c), c.req.param('id'));
      return c.body(null, 204);
    })
    // Источники сборщика (admin/sources.ts).
    .get('/admin/sources', async (c) => c.json(await admin.listSources(db)))
    .post('/admin/sources', json(SourceCreateInput), async (c) => c.json(await admin.createSource(db, ctx(c), c.req.valid('json')), 201))
    .patch('/admin/sources/:channel', json(SourceUpdateInput), async (c) => c.json(await admin.updateSource(db, ctx(c), c.req.param('channel'), c.req.valid('json'))))

    // Пользователи и аудитория организаторов.
    .get('/admin/users', async (c) => c.json(await admin.searchUsers(db, UserSearchInput.parse(c.req.query()).query)))
    .get('/admin/users/:id', async (c) => c.json(await admin.getUser(db, userId.parse(c.req.param('id')))))
    .patch('/admin/users/:id', json(UserUpdateInput), async (c) => c.json(await admin.updateUser(db, ctx(c), userId.parse(c.req.param('id')), c.req.valid('json'))))
    .delete('/admin/users/:id', async (c) => {
      await admin.deleteUser(db, ctx(c), userId.parse(c.req.param('id')));
      return c.body(null, 204);
    })
    .delete('/admin/users/:id/tokens', async (c) => {
      await admin.revokeUserTokens(db, ctx(c), userId.parse(c.req.param('id')));
      return c.body(null, 204);
    })
    .get('/admin/contacts', async (c) => c.json(await admin.listAnyContacts(db, AdminContactListInput.parse(c.req.query()).host_user_id)))
    .delete('/admin/contacts/:id', async (c) => {
      await admin.removeContact(db, ctx(c), c.req.param('id'));
      return c.body(null, 204);
    })

    // Журнал действий команды и отмена.
    .get('/admin/actions', async (c) => c.json(await admin.listAdminActions(db, AdminActionListInput.parse(c.req.query()))))
    .get('/admin/actions/:id', async (c) => c.json(await admin.getAdminAction(db, c.req.param('id'))))
    .post('/admin/actions/:id/undo', async (c) => c.json(await admin.undoAdminAction(db, ctx(c), c.req.param('id')), 201))

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
