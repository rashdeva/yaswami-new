// Разовый скрипт: сжать тяжёлые фото, что уже лежат в базе.
// Запуск: DATABASE_URL=... node apps/api/src/optimize-photos.ts [минимальный_размер_в_байтах]
import { createDb } from './db/client.ts';
import { optimizeStoredPhotos } from './photos.ts';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const db = createDb(process.env.DATABASE_URL);
const r = await optimizeStoredPhotos(db, Number(process.argv[2]) || undefined);
console.log(`сжато ${r.count} фото: ${(r.before / 1e6).toFixed(1)} МБ → ${(r.after / 1e6).toFixed(1)} МБ`);
await db.$client.end();
