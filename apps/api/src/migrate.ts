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

// Город по умолчанию у этой копии (DEFAULT_CITY_ID) — и в базе: колонки city_id без явного города получают его. В схеме
// и миграциях стоит запасной 'danang'. Трогаем, только если переменная задана: сюда приходят и API, и сборщик, и сервис
// без неё не должен вернуть чужой копии Дананг. Меняем только то, что отличается: ALTER берёт блокировку таблицы.
// Города нет в cities — оставляем как есть, иначе новые строки упадут на внешнем ключе.
const city = process.env.DEFAULT_CITY_ID;
if (city) {
  // Значение по умолчанию не передать параметром: id вставляется в текст запроса, поэтому сначала проверяем, что это slug.
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(city)) throw new Error(`DEFAULT_CITY_ID=${city} is not a city slug`);
  const sql = db.$client;
  const [known] = await sql`select 1 from cities where id = ${city}`;
  if (!known) console.warn(`DEFAULT_CITY_ID=${city}: such a city is not in cities yet, column defaults stay as they are`);
  else {
    const columns = await sql<{ table_name: string; column_default: string }[]>`
      select table_name, column_default from information_schema.columns
      where table_schema = 'public' and column_name = 'city_id' and column_default is not null`;
    for (const { table_name, column_default } of columns) {
      if (column_default.startsWith(`'${city}'`)) continue;
      await sql`alter table ${sql(table_name)} alter column city_id set default ${sql.unsafe(`'${city}'`)}`;
    }
  }
}
await db.$client.end();
console.log('migrations applied');
