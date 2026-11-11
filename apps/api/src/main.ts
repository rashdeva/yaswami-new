import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { createDb } from './db/client.ts';

const { DATABASE_URL, BOT_TOKEN, PORT = '3000' } = process.env;
if (!DATABASE_URL) throw new Error('DATABASE_URL is required');
if (!BOT_TOKEN) console.warn('BOT_TOKEN is not set: Telegram login is disabled, only access tokens work');

const app = createApp({ db: createDb(DATABASE_URL), botToken: BOT_TOKEN ?? '' });
serve({ fetch: app.fetch, port: Number(PORT) }, ({ port }) => console.log(`api: http://localhost:${port}  mcp: http://localhost:${port}/mcp`));
