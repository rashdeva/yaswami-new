import { existsSync, readFileSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { createApp } from './app.ts';
import { createDb } from './db/client.ts';
import { eventPage, feedPage, inject, notFoundPage, sitemap } from './pages.ts';
import type { Page } from './pages.ts';
import { AppError, getCollectedEvent, listCollectedEvents } from './services.ts';
import { settings } from './settings.ts';

const { DATABASE_URL, BOT_TOKEN, APP_NAME = 'app', PORT = '3000', TG_CLIENT_SECRET = '' } = process.env;
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

const db = createDb(DATABASE_URL);
const api = createApp({
  db,
  botToken: BOT_TOKEN ?? '',
  config: { bot_username: BOT_TOKEN ? await botUsername(BOT_TOKEN) : null, app_name: APP_NAME },
  webLogin: { clientSecret: TG_CLIENT_SECRET, publicUrl: PUBLIC_URL },
});

// Один сервер на всё: REST под /api, MCP на /mcp, остальное — собранное мини-приложение.
const server = new Hono()
  .route('/api', api)
  .on(['GET', 'POST', 'DELETE'], ['/mcp', '/health'], (c) => api.fetch(c.req.raw));

const WEB = 'apps/web/dist'; // появляется после `pnpm build:web`; в разработке фронт отдаёт Vite
if (existsSync(WEB)) {
  // Файлы сборки с хэшем в имени кэшируются навсегда, страница — никогда: иначе Telegram покажет старую версию.
  const cache = (path: string) => (path.endsWith('.html') ? 'no-cache' : 'public, max-age=31536000, immutable');
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
