import { defineConfig } from 'drizzle-kit';

// Запускается из apps/api; .env лежит в корне репозитория.
if (!process.env.DATABASE_URL) process.loadEnvFile('../../.env');

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL! },
  // Не трогать служебные таблицы PostGIS (spatial_ref_sys и др.).
  extensionsFilters: ['postgis'],
});
