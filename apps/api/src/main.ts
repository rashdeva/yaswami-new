import { existsSync, readFileSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { createApp } from './app.ts';
import { createDb } from './db/client.ts';
import { eventPage, feedPage, inject, notFoundPage, sitemap } from './pages.ts';
import type { Page } from './pages.ts';
import { AppError, getCollectedEvent, listCollectedEvents, startVideoLoop } from './services.ts';
import { settings } from './settings.ts';
import { bot } from './telegram.ts';
import { startFeedbackLoop } from './feedback.ts';

const { DATABASE_URL, BOT_TOKEN, APP_NAME = 'app', PORT = '3000', TG_CLIENT_SECRET = '', TELEGRAM_WEBHOOK_SECRET = '' } = process.env;
const { publicUrl: PUBLIC_URL, city: CITY } = settings;
if (!DATABASE_URL) throw new Error('DATABASE_URL is required');
if (!TG_CLIENT_SECRET) console.warn('TG_CLIENT_SECRET is not set: login on the website is disabled');
if (!BOT_TOKEN) console.warn('BOT_TOKEN is not set: Telegram login is disabled, only access tokens work');

/** Имя бота для ссылок на события. Сервер спрашивает его у Telegram сам, чтобы не настраивать отдельно. */
async function botUsername(token: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(5000) });
    const body = (await res.json()) as { ok: boolean; result?: { username?: string } };
    return body.result?.username ?? null;
  } catch {
    return null;
  }
}

if (!TELEGRAM_WEBHOOK_SECRET) console.warn('TELEGRAM_WEBHOOK_SECRET is not set: the bot webhook is closed');

const db = createDb(DATABASE_URL);
Object.assign(bot, { token: BOT_TOKEN ?? '', username: BOT_TOKEN ? await botUsername(BOT_TOKEN) : null, appName: APP_NAME });
const api = createApp({
  db,
  botToken: bot.token,
  config: { bot_username: bot.username, app_name: APP_NAME },
  webLogin: { clientSecret: TG_CLIENT_SECRET, publicUrl: PUBLIC_URL },
  telegram: { webhookSecret: TELEGRAM_WEBHOOK_SECRET },
});

// После событий бот просит у гостей отзыв и шлёт организаторам сводки. Без токена отправлять нечем.
if (BOT_TOKEN) startFeedbackLoop(db);
startVideoLoop(db); // без роли illustrator (ILLUSTRATOR_URL пуст) ничего не делает

// Один сервер на всё: REST под /api, MCP на /mcp, админка под /admin, остальное — собранное мини-приложение.
// Заголовки безопасности на всё: HSTS, nosniff, Referrer-Policy. Запрет встраивания во фрейм — только админке:
// мини-приложение Telegram в веб-версии открывает именно во фрейме. Cross-Origin-* не ставим по той же причине.
// ponytail: полной Content-Security-Policy нет — её надо собирать под скрипты Telegram и PostHog и проверять в приложении.
const HEADERS = { crossOriginResourcePolicy: false, crossOriginOpenerPolicy: false, referrerPolicy: 'strict-origin-when-cross-origin' } as const;
const server = new Hono()
  .use(secureHeaders({ ...HEADERS, xFrameOptions: false }))
  .use('/admin/*', secureHeaders({ ...HEADERS, contentSecurityPolicy: { frameAncestors: ["'none'"] } }))
  .route('/api', api)
  .on(['GET', 'POST', 'DELETE'], ['/mcp', '/health'], (c) => api.fetch(c.req.raw));

// Файлы сборки с хэшем в имени кэшируются навсегда, страница — никогда: иначе Telegram покажет старую версию.
const cache = (path: string) => (path.endsWith('.html') ? 'no-cache' : 'public, max-age=31536000, immutable');

const ADMIN = 'apps/admin/dist'; // появляется после `pnpm build:admin`; собрана с base: '/admin/'
if (existsSync(ADMIN)) {
  // Раньше общего обработчика мини-приложения: любой путь под /admin — файл сборки или страница админки.
  const file = serveStatic({ root: ADMIN, rewriteRequestPath: (path) => path.replace(/^\/admin/, ''), onFound: (path, c) => c.header('Cache-Control', cache(path)) });
  const page = serveStatic({ root: ADMIN, path: 'index.html', onFound: (_path, c) => c.header('Cache-Control', 'no-cache') });
  server.get('/admin', page).use('/admin/*', file).get('/admin/*', page);
}

const WEB = 'apps/web/dist'; // появляется после `pnpm build:web`; в разработке фронт отдаёт Vite
if (existsSync(WEB)) {
  // Витрина и страница собранного события приходят с сервера уже с содержимым (pages.ts): их читают поисковики.
  const template = readFileSync(`${WEB}/index.html`, 'utf8');
  const html = (page: Page) =>
    new Response(inject(template, page), { status: page.status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } });
  server
    .get('/', async () => html(feedPage(await listCollectedEvents(db), PUBLIC_URL, CITY)))
    .get('/e/:id', async (c) => {
      try {
        return html(eventPage(await getCollectedEvent(db, c.req.param('id')), PUBLIC_URL, CITY));
      } catch (e) {
        if (e instanceof AppError && e.status === 404) return html(notFoundPage(PUBLIC_URL));
        throw e;
      }
    })
    .get('/sitemap.xml', async (c) => c.body(sitemap(await listCollectedEvents(db), PUBLIC_URL), 200, { 'content-type': 'application/xml' }))
    .get('/robots.txt', (c) => c.text(`User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${PUBLIC_URL}/sitemap.xml\n`))
    .use('*', serveStatic({ root: WEB, onFound: (path, c) => c.header('Cache-Control', cache(path)) }))
    .get('*', serveStatic({ root: WEB, path: 'index.html', onFound: (_path, c) => c.header('Cache-Control', 'no-cache') }));
}

serve({ fetch: server.fetch, port: Number(PORT) }, ({ port }) => console.log(`http://localhost:${port}  api: /api  mcp: /mcp`));
