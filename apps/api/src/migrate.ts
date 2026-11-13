// Применяет миграции при старте контейнера. Локально то же делает `pnpm db:migrate`.
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './db/client.ts';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const db = createDb(process.env.DATABASE_URL);
// API и сборщик стартуют из одного образа и оба приходят сюда: блокировка ставит их в очередь, иначе миграция
// с данными могла бы примениться дважды. Второй дождётся первого и увидит, что применять нечего.
const lock = await db.$client.reserve();
await lock`select pg_advisory_lock(20261114)`;
try {
  await migrate(db, { migrationsFolder: new URL('../drizzle', import.meta.url).pathname });
} finally {
  await lock`select pg_advisory_unlock(20261114)`;
  lock.release();
}
await db.$client.end();
console.log('migrations applied');
