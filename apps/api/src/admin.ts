// Операции команды над всем сервисом: любое событие, любой пользователь, организаторы, каталог. Кто вправе их вызывать,
// решают входы (REST — `/admin/*`, MCP — блок для админа); сами операции прав не проверяют. Каждое изменение идёт
// через журнал (audit.ts). Операции лежат по ресурсам в admin/; переписка и аккаунты — в inbox.ts.
import type { User } from '@yaswami/core';
import { userById } from './admin/users.ts';
import type { Ctx } from './audit.ts';
import { audited } from './audit.ts';
import type { Db } from './db/client.ts';

export * from './admin/events.ts';
export * from './admin/catalog.ts';
export * from './admin/users.ts';
export * from './admin/sources.ts';
export { getAdminAction, listAdminActions, undoAdminAction } from './audit.ts';

/**
 * Админ действует от имени пользователя (`as_user_id` в инструментах MCP): строка журнала с именем инструмента
 * и снимком пользователя. Не отменяется — это действие самого пользователя, его отменяют так же, как он бы сам.
 */
export const actAsUser = <T>(db: Db, ctx: Ctx, action: string, userId: number, input: object, run: (db: Db, me: User) => Promise<T>) =>
  audited(db, ctx, { action, entity: 'user', id: String(userId), input: { as_user_id: userId, ...input }, undoable: false }, async (tx) => run(tx, await userById(tx, userId)));
