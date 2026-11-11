// Выпуск токена из консоли, пока в мини-приложении и боте нет своей кнопки:
//   pnpm api:token <telegram id> [имя]
import { issueToken, upsertUser } from './auth.ts';
import { createDb } from './db/client.ts';

const [id, first_name = 'Dev'] = process.argv.slice(2);
if (!process.env.DATABASE_URL || !Number.isSafeInteger(Number(id))) {
  console.error('usage: pnpm api:token <telegram id> [first name]');
  process.exit(1);
}
const db = createDb(process.env.DATABASE_URL);
const user = await upsertUser(db, { id: Number(id), first_name });
console.log(await issueToken(db, user.id));
await db.$client.end();
