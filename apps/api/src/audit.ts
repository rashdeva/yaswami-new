// Журнал действий команды и их отмена (ADR-0004). Каждое изменение из админки и через admin_* в MCP проходит через
// `audited`: в одной транзакции снимок сущности до, само действие, снимок после и строка журнала. Отмена — восстановить
// снимок «до», если с тех пор сущность никто не трогал.
import { AsyncLocalStorage } from 'node:async_hooks';
import { isDeepStrictEqual } from 'node:util';
import { and, desc, eq, getTableColumns, sql } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { AdminAction, AdminActionList, AdminActionListInput, AdminEntity, User } from '@yaswami/core';
import type { Db } from './db/client.ts';
import {
  adminActions, cities, collectedEvents, collectedEventSignups, contacts, conversations, eventFeedback, events, guests, hosts, messages, photos, practiceSignups, shares, sources,
  ticketTypes, tgAccounts, users,
} from './db/schema.ts';
import { AppError, collectedExternalId } from './services.ts';

/** Кто действует и через какой вход. Агент через MCP — это владелец токена. */
export interface Ctx {
  actor: User;
  via: AdminAction['via'];
}

// --- Побочные действия вне базы

const pending = new AsyncLocalStorage<{ db: Db; jobs: (() => void)[] }>();

/**
 * Побочное действие вне базы (Telegram, заказ ролика), которое сервис запускает после своей записи. Внутри действия
 * команды оно ждёт фиксации транзакции журнала и не случается, если та откатилась. `job` получает настоящую базу,
 * а не транзакцию: та к его запуску уже закрыта.
 */
export function afterCommit(db: Db, job: (db: Db) => unknown): void {
  const run = (base: Db) => void Promise.resolve(job(base)).catch(console.error);
  const store = pending.getStore();
  if (store) store.jobs.push(() => run(store.db));
  else run(db);
}

// --- Снимок и восстановление

/**
 * Что входит в снимок сущности: строка `root` и строки `children`, ссылающиеся на неё (порядок — порядок вставки
 * при восстановлении). `omit` — колонки, которых в журнале быть не должно (сессия и вход аккаунта).
 * Заходы (`visits`) не входят: это счётчик, а не данные, которые правит команда.
 */
interface Kind {
  root: PgTable;
  key: AnyPgColumn;
  toKey?: (id: string) => unknown;
  omit?: string[];
  children?: Record<string, AnyPgColumn>;
}
const KINDS: Record<AdminEntity, Kind> = {
  event: { root: events, key: events.id, children: { ticket_types: ticketTypes.event_id, guests: guests.event_id, shares: shares.event_id, feedback: eventFeedback.event_id } },
  collected_event: {
    root: collectedEvents, key: collectedEvents.external_id, toKey: (id) => collectedExternalId(id),
    children: { cover: photos.collected_external_id, signups: collectedEventSignups.external_id },
  },
  host: { root: hosts, key: hosts.id, children: { photos: photos.host_id, practice_signups: practiceSignups.host_id } },
  // Аватар не входит: он подтянется из Telegram при следующем входе. Токены не входят никогда.
  user: {
    root: users, key: users.id, toKey: Number,
    children: { guests: guests.user_id, collected_signups: collectedEventSignups.user_id, contacts: contacts.user_id, audience: contacts.host_user_id, feedback: eventFeedback.user_id },
  },
  account: { root: tgAccounts, key: tgAccounts.id, omit: ['session', 'login'] },
  conversation: { root: conversations, key: conversations.id },
  message: { root: messages, key: messages.id },
  contact: { root: contacts, key: contacts.id },
  source: { root: sources, key: sources.channel },
  city: { root: cities, key: cities.id },
};

/** Снимок — JSON: даты строками ISO, байты (фото) — base64. Строки детей по порядку, чтобы снимки сравнивались. */
const plain = (value: unknown) =>
  JSON.parse(JSON.stringify(value, (_k, v) => (v?.type === 'Buffer' && Array.isArray(v.data) ? Buffer.from(v.data).toString('base64') : v)));
const sorted = (rows: unknown[]) => (plain(rows) as unknown[]).map((r) => [JSON.stringify(r), r] as const).sort(([a], [b]) => (a < b ? -1 : 1)).map(([, r]) => r);
const tableOf = (column: AnyPgColumn) => column.table as PgTable;

/** Обратно из JSON в значения колонок: строки дат — в Date, base64 — в байты. */
function revive(table: PgTable, row: Record<string, unknown>) {
  const out = { ...row };
  for (const [name, column] of Object.entries(getTableColumns(table))) {
    const v = out[name];
    if (typeof v !== 'string') continue;
    if (column.columnType === 'PgTimestamp') out[name] = new Date(v);
    else if (column.getSQLType() === 'bytea') out[name] = Buffer.from(v, 'base64');
  }
  return out;
}

export type Snapshot = Record<string, unknown> & { row: Record<string, unknown> };

/** Полное состояние сущности; null — её нет. `lock` — заблокировать строку до конца транзакции. */
export async function snapshot(db: Db, entity: AdminEntity, id: string, lock = false): Promise<Snapshot | null> {
  const k = KINDS[entity];
  const key = k.toKey ? k.toKey(id) : id;
  const columns = Object.fromEntries(Object.entries(getTableColumns(k.root)).filter(([name]) => !k.omit?.includes(name)));
  const q = db.select(columns).from(k.root).where(eq(k.key, key));
  const [row] = await (lock ? q.for('update') : q);
  if (!row) return null;
  const snap: Snapshot = { row: plain(row) };
  for (const [name, column] of Object.entries(k.children ?? {})) snap[name] = sorted(await db.select().from(tableOf(column)).where(eq(column, key)));
  return snap;
}

/** Привести строки к снимку; null — удалить сущность. Дети заменяются целиком, корневая строка — обновляется на месте. */
export async function restore(db: Db, entity: AdminEntity, id: string, snap: Snapshot | null): Promise<void> {
  const k = KINDS[entity];
  const key = k.toKey ? k.toKey(id) : id;
  const children = Object.entries(k.children ?? {});
  for (const [, column] of [...children].reverse()) await db.delete(tableOf(column)).where(eq(column, key));
  if (!snap) {
    await db.delete(k.root).where(eq(k.key, key));
    return;
  }
  const row = revive(k.root, snap.row);
  await db.insert(k.root).values(row as never).onConflictDoUpdate({ target: k.key, set: row as never });
  for (const [name, column] of children) {
    const rows = snap[name] as Record<string, unknown>[];
    if (rows.length) await db.insert(tableOf(column)).values(rows.map((r) => revive(tableOf(column), r)) as never);
  }
}

// --- Обёртка

interface Audit<T> {
  action: string; // имя инструмента MCP
  entity: AdminEntity;
  /** id сущности; функция — когда он появится только в результате (создание). */
  id: string | ((result: T) => string);
  /** Что передали. Секреты сюда не кладут. */
  input?: unknown;
  /** false — действие не вернуть: ушло в Telegram, потрачены деньги, сделано от имени пользователя. */
  undoable?: boolean;
  undo_of?: string;
}

/**
 * Действие команды с записью в журнал. `run` получает транзакцию вместо базы: сервисы, открывающие свои транзакции,
 * работают внутри неё точками сохранения. Упало действие — нет ни изменения, ни строки журнала, ни побочных
 * действий из `afterCommit`.
 */
export async function audited<T>(db: Db, ctx: Ctx, a: Audit<T>, run: (tx: Db) => Promise<T>): Promise<T> {
  const store = { db, jobs: [] as (() => void)[] };
  const result = await pending.run(store, () =>
    db.transaction(async (t) => {
      const tx = t as unknown as Db;
      const before = typeof a.id === 'string' ? await snapshot(tx, a.entity, a.id) : null;
      const result = await run(tx);
      const entity_id = typeof a.id === 'string' ? a.id : a.id(result);
      const [row] = await tx.insert(adminActions).values({
        actor_id: ctx.actor.id, via: ctx.via, action: a.action, entity: a.entity, entity_id, input: a.input ?? null,
        before, after: await snapshot(tx, a.entity, entity_id), undoable: a.undoable ?? true, undo_of: a.undo_of ?? null,
      }).returning({ id: adminActions.id });
      if (a.undo_of) await tx.update(adminActions).set({ undone_by: row!.id }).where(eq(adminActions.id, a.undo_of));
      return result;
    }),
  );
  for (const job of store.jobs) job();
  return result;
}

// --- Чтение и отмена

const entryFields = (({ before: _b, after: _a, ...rest }) => rest)(getTableColumns(adminActions));

export async function listAdminActions(db: Db, input: AdminActionListInput): Promise<AdminActionList> {
  const t = adminActions;
  const limit = input.pagination_limit ?? 50;
  const rows = await db.select(entryFields).from(t)
    .where(and(
      input.entity ? eq(t.entity, input.entity) : undefined,
      input.entity_id ? eq(t.entity_id, input.entity_id) : undefined,
      input.actor_id ? eq(t.actor_id, input.actor_id) : undefined,
      input.action ? eq(t.action, input.action) : undefined,
      input.pagination_cursor
        ? sql`(${t.created_at}, ${t.id}) < (select created_at, id from admin_actions where id = ${input.pagination_cursor})`
        : undefined,
    ))
    .orderBy(desc(t.created_at), desc(t.id)).limit(limit + 1);
  const entries = rows.slice(0, limit);
  const has_more = rows.length > limit;
  return { entries, has_more, next_cursor: has_more ? entries.at(-1)!.id : null };
}

export async function getAdminAction(db: Db, id: string): Promise<AdminAction> {
  const [row] = await db.select().from(adminActions).where(eq(adminActions.id, id));
  if (!row) throw new AppError('not_found', 404);
  return row;
}

/** Нарушение ключей или ограничений базы (класс 23 в Postgres): drizzle кладёт ошибку драйвера в `cause`. */
const isIntegrityError = (e: unknown) => {
  const code = (e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code;
  return typeof code === 'string' && code.startsWith('23');
};

/**
 * Отменить действие: вернуть сущность к снимку «до». Только если с тех пор её не меняли (текущий снимок равен «после»),
 * иначе отмена затёрла бы чужую правку. Отмена — сама действие журнала, её тоже можно отменить.
 */
export async function undoAdminAction(db: Db, ctx: Ctx, id: string): Promise<AdminAction> {
  const action = await getAdminAction(db, id);
  if (!action.undoable) throw new AppError('not_undoable', 409);
  await audited(db, ctx, { action: 'admin_actions_undo', entity: action.entity, id: action.entity_id, input: { id }, undo_of: id }, async (tx) => {
    const [locked] = await tx.select({ undone_by: adminActions.undone_by }).from(adminActions).where(eq(adminActions.id, id)).for('update');
    if (locked!.undone_by) throw new AppError('already_undone', 409);
    if (!isDeepStrictEqual(await snapshot(tx, action.entity, action.entity_id, true), action.after)) throw new AppError('changed_since', 409);
    try {
      await restore(tx, action.entity, action.entity_id, action.before as Snapshot | null);
    } catch (e) {
      // Снимок ссылается на то, чего уже нет (удалили событие гостя, тип билета): вернуть нельзя.
      if (isIntegrityError(e)) throw new AppError('changed_since', 409);
      throw e;
    }
  });
  const [undo] = await db.select().from(adminActions).where(eq(adminActions.undo_of, id));
  return undo!;
}
