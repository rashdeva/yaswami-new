import { defineConfig } from 'drizzle-kit';

// Запускается из apps/api; .env лежит в корне репозитория.
if (!process.env.DATABASE_URL) process.loadEnvFile('../../.env');

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL! },
  // Имя файла — время создания, а не порядковый номер: ветки из параллельных worktree не делят один номер.
  // Старые 0000–0023 остаются как есть; порядок применения задаёт `when` в meta/_journal.json, не имя.
  migrations: { prefix: 'timestamp' },
  // Не трогать служебные таблицы PostGIS (spatial_ref_sys и др.).
  extensionsFilters: ['postgis'],
});
