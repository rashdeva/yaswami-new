// Разовый скрипт: перенести обложки событий из базы в бакет R2 (ADR-0011) и стереть их байты из photos.
// Запуск: DATABASE_URL=... S3_ENDPOINT=... S3_BUCKET=... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... MEDIA_PUBLIC_URL=... node apps/api/src/move-covers.ts
// Место на диске Postgres освобождается не сразу: строки займёт autovacuum; вернуть его системе — `VACUUM FULL photos` (блокирует таблицу).
import { bucket } from './bucket.ts';
import { createDb } from './db/client.ts';
import { moveCoversToBucket } from './photos.ts';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const b = bucket();
if (!b) throw new Error('S3_ENDPOINT, S3_BUCKET и MEDIA_PUBLIC_URL обязательны');
const db = createDb(process.env.DATABASE_URL);
const r = await moveCoversToBucket(db, b);
console.log(`перенесено ${r.count} обложек, из базы ушло ${(r.bytes / 1e6).toFixed(1)} МБ`);
await db.$client.end();
