// Журнал действий команды: подписи действий и сущностей, куда ведёт сущность, разница снимков. Без React.
import type { AdminEntity } from '@yaswami/core';

/** Подпись действия по имени инструмента MCP. Новое действие команды — строка здесь. */
export const ACTIONS: Record<string, string> = {
  admin_events_create: 'Создано событие',
  admin_events_update: 'Изменено событие',
  admin_events_delete: 'Удалено событие',
  admin_events_guests_update: 'Изменён ответ гостя',
  admin_events_guests_remove: 'Убран гость',
  admin_events_ticket_types_create: 'Добавлен тип билета',
  admin_events_ticket_types_update: 'Изменён тип билета',
  admin_events_ticket_types_delete: 'Удалён тип билета',
  admin_events_feedback_delete: 'Удалён отзыв',
  admin_collected_events_update: 'Изменено событие каталога',
  admin_collected_events_delete: 'Удалено событие каталога',
  admin_collected_events_redo: 'Перерисовка обложки и ролика',
  admin_covers_set: 'Решение по обложке',
  admin_videos_request: 'Заказан ролик',
  admin_hosts_create: 'Добавлен организатор',
  admin_hosts_update: 'Изменён организатор',
  admin_practices_update: 'Изменена услуга',
  admin_hosts_delete: 'Удалён организатор',
  admin_users_update: 'Изменён пользователь',
  admin_users_delete: 'Удалён пользователь',
  admin_users_tokens_revoke: 'Отозваны токены',
  admin_contacts_remove: 'Убран контакт',
  admin_sources_create: 'Добавлен источник',
  admin_sources_update: 'Изменён источник',
  admin_cities_create: 'Добавлен город',
  admin_cities_update: 'Изменён город',
  admin_accounts_create: 'Добавлен аккаунт Telegram',
  admin_accounts_update: 'Изменён аккаунт',
  admin_accounts_delete: 'Удалён аккаунт Telegram',
  admin_accounts_login: 'Шаг входа в аккаунт',
  admin_conversations_update: 'Изменён диалог',
  admin_messages_send: 'Отправлено сообщение',
  admin_drafts_send: 'Отправлен черновик',
  admin_drafts_update: 'Исправлен черновик',
  admin_drafts_reject: 'Отклонён черновик',
  admin_actions_undo: 'Отмена действия',
};

/** Подпись действия; неизвестное без `admin_` — действие от имени пользователя (`as_user_id` в MCP). */
export const actionLabel = (action: string) => ACTIONS[action] ?? (action.startsWith('admin_') ? action : `От имени пользователя: ${action}`);

export const ENTITIES: Record<AdminEntity, string> = {
  event: 'Событие Ясвами',
  collected_event: 'Событие каталога',
  host: 'Организатор',
  user: 'Пользователь',
  account: 'Аккаунт Telegram',
  conversation: 'Диалог',
  message: 'Сообщение',
  contact: 'Контакт',
  source: 'Источник',
  city: 'Город',
};

/** Куда ведёт сущность в админке; null — своей карточки нет (сообщение, контакт). */
export type EntityLink =
  | { to: '/events/$id' | '/catalog/$id' | '/hosts/$id' | '/users/$id'; params: { id: string } }
  | { to: '/'; search: { c: string } }
  | { to: '/accounts' | '/sources' | '/cities' }
  | null;

export function entityLink(entity: AdminEntity, id: string): EntityLink {
  switch (entity) {
    case 'event': return { to: '/events/$id', params: { id } };
    case 'collected_event': return { to: '/catalog/$id', params: { id } };
    case 'host': return { to: '/hosts/$id', params: { id } };
    case 'user': return { to: '/users/$id', params: { id } };
    case 'conversation': return { to: '/', search: { c: id } };
    case 'account': return { to: '/accounts' };
    case 'source': return { to: '/sources' };
    case 'city': return { to: '/cities' };
    default: return null;
  }
}

/** Подписи детей снимка (`KINDS` в apps/api/src/audit.ts). */
export const CHILDREN: Record<string, string> = {
  ticket_types: 'Типы билетов', guests: 'Гости', shares: 'Отправленные карточки', feedback: 'Отзывы', cover: 'Обложка', signups: 'Записавшиеся',
  photos: 'Фото', practices: 'Услуги', practice_signups: 'Заявки на услуги', collected_signups: 'Записи на события каталога', contacts: 'В контактах у организаторов', audience: 'Аудитория',
};

type Snap = { row?: Record<string, unknown> } & Record<string, unknown>;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Что изменило действие: поля корневой строки, которые различаются, и сколько детей было и стало.
 * `kind` — создано (до не было), удалено (после нет) или изменено; у созданного и удалённого поля — все.
 */
export function snapshotDiff(before: unknown, after: unknown) {
  const b = (before ?? null) as Snap | null;
  const a = (after ?? null) as Snap | null;
  const rb = b?.row ?? {};
  const ra = a?.row ?? {};
  const fields = [...new Set([...Object.keys(rb), ...Object.keys(ra)])]
    .filter((key) => !same(rb[key], ra[key]))
    .map((key) => ({ key, before: rb[key] ?? null, after: ra[key] ?? null }));
  const names = [...new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})])].filter((k) => k !== 'row');
  const count = (s: Snap | null, k: string) => (s && Array.isArray(s[k]) ? (s[k] as unknown[]).length : null);
  const children = names.map((name) => ({ name, before: count(b, name), after: count(a, name), changed: !same(b?.[name], a?.[name]) }));
  return { kind: !b ? ('created' as const) : !a ? ('deleted' as const) : ('changed' as const), fields, children };
}

/** Значение поля снимка для таблицы разницы. */
export function showValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'да' : 'нет';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 300 ? `${s.slice(0, 300)}…` : s;
}
