import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { createApp } from './app.ts';
import { createDb } from './db/client.ts';

const { DATABASE_URL, BOT_TOKEN, APP_NAME = 'app', PORT = '3000' } = process.env;
if (!DATABASE_URL) throw new Error('DATABASE_URL is required');
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

const api = createApp({
  db: createDb(DATABASE_URL),
  botToken: BOT_TOKEN ?? '',
  config: { bot_username: BOT_TOKEN ? await botUsername(BOT_TOKEN) : null, app_name: APP_NAME },
});

// Один сервер на всё: REST под /api, MCP на /mcp, остальное — собранное мини-приложение.
const server = new Hono()
  .route('/api', api)
  .on(['GET', 'POST', 'DELETE'], ['/mcp', '/health'], (c) => api.fetch(c.req.raw));

const WEB = 'apps/web/dist'; // появляется после `pnpm build:web`; в разработке фронт отдаёт Vite
if (existsSync(WEB)) {
  // Файлы сборки с хэшем в имени кэшируются навсегда, страница — никогда: иначе Telegram покажет старую версию.
  const cache = (path: string) => (path.endsWith('.html') ? 'no-cache' : 'public, max-age=31536000, immutable');
  server
    .use('*', serveStatic({ root: WEB, onFound: (path, c) => c.header('Cache-Control', cache(path)) }))
    .get('*', serveStatic({ root: WEB, path: 'index.html', onFound: (_path, c) => c.header('Cache-Control', 'no-cache') }));
}

serve({ fetch: server.fetch, port: Number(PORT) }, ({ port }) => console.log(`http://localhost:${port}  api: /api  mcp: /mcp`));
