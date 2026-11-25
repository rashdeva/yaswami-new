// Выпуск токена из консоли, пока в мини-приложении и боте нет своей кнопки:
//   pnpm api:token <telegram id> [имя] [область]
// Область — для роли Hermes: support, catalog или curator (TOKEN_SCOPES в db/schema.ts). Без неё токен может всё, что его владелец.
import { issueToken, upsertUser, userIdByTelegram } from './auth.ts';
import { createDb } from './db/client.ts';
import type { TokenScope } from './db/schema.ts';
import { TOKEN_SCOPES } from './db/schema.ts';

const [id, first_name = 'Dev', scope] = process.argv.slice(2);
if (!process.env.DATABASE_URL || !Number.isSafeInteger(Number(id)) || (scope && !TOKEN_SCOPES.includes(scope as TokenScope))) {
  console.error(`usage: pnpm api:token <telegram id> [first name] [${TOKEN_SCOPES.join('|')}]`);
  process.exit(1);
}
const db = createDb(process.env.DATABASE_URL);
// Человек — по Telegram id (способ входа telegram, ADR-0008). Уже известного не трогаем: upsertUser переписал бы
// его имя и стёр username до следующего входа.
const known = await userIdByTelegram(db, Number(id));
const userId = known ?? (await upsertUser(db, { id: Number(id), first_name })).id;
console.log(await issueToken(db, userId, { scope: scope as TokenScope | undefined }));
await db.$client.end();
