import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.ts';

// Уведомления Postgres (NOTICE) в лог не пишем.
export const createDb = (url: string) => drizzle({ connection: { url, onnotice: () => {} }, schema });
export type Db = ReturnType<typeof createDb>;
/** База или открытая транзакция. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
