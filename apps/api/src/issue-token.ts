// Выпуск токена из консоли, пока в мини-приложении и боте нет своей кнопки:
//   pnpm api:token <telegram id> [имя] [область]
// Область — для роли Hermes: support или catalog (TOKEN_SCOPES в db/schema.ts). Без неё токен может всё, что его владелец.
import { issueToken, upsertUser } from './auth.ts';
import { createDb } from './db/client.ts';
import type { TokenScope } from './db/schema.ts';
import { TOKEN_SCOPES, users } from './db/schema.ts';
import { eq } from 'drizzle-orm';

const [id, first_name = 'Dev', scope] = process.argv.slice(2);
if (!process.env.DATABASE_URL || !Number.isSafeInteger(Number(id)) || (scope && !TOKEN_SCOPES.includes(scope as TokenScope))) {
  console.error(`usage: pnpm api:token <telegram id> [first name] [${TOKEN_SCOPES.join('|')}]`);
  process.exit(1);
}
const db = createDb(process.env.DATABASE_URL);
// Уже известного человека не трогаем: upsertUser переписал бы его имя и стёр username до следующего входа.
const [known] = await db.select().from(users).where(eq(users.id, Number(id)));
const user = known ?? (await upsertUser(db, { id: Number(id), first_name }));
console.log(await issueToken(db, user.id, { scope: scope as TokenScope | undefined }));
await db.$client.end();
