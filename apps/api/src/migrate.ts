// Применяет миграции при старте контейнера. Локально то же делает `pnpm db:migrate`.
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './db/client.ts';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const db = createDb(process.env.DATABASE_URL);
await migrate(db, { migrationsFolder: new URL('../drizzle', import.meta.url).pathname });
await db.$client.end();
console.log('migrations applied');
