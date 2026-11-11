// Клиент API. Формы запросов и ответов — из @yaswami/core, те же, что проверяет бэк.
import type { AdminCollectedEvent, AccountCreateInput, AdminOverview, AppConfig, CollectedEventItem, Conversation, ConversationUpdateInput, TgAccount, EventCreateInput, EventListItem, EventUpdateInput, EventView, InboxFeed, Me, Message, MyCollectedItem, RsvpInput, VisitInput, Wire } from '@yaswami/core';
import { inTelegram, tg } from './tg.ts';

const BASE = import.meta.env.VITE_API_URL ?? '/api';
const devToken = import.meta.env.DEV ? import.meta.env.VITE_DEV_TOKEN : undefined;
const authorization = inTelegram ? `tma ${tg!.initData}` : devToken ? `Bearer ${devToken}` : null;

/** Вход известен сразу: открыты в Telegram или задан токен разработчика. Иначе — только cookie сайта, если она есть. */
export const hasCredentials = authorization !== null;

/** Адрес входа на сайте через Telegram; после входа человек вернётся на `back`. */
export const loginUrl = (back: string) => `${BASE}/auth/telegram/login?return=${encodeURIComponent(back)}`;

const MESSAGES: Record<string, string> = {
  full: 'Свободных мест больше нет',
  closed: 'Событие закрыто для ответов',
  ticket_required: 'Выберите билет',
  ticket_unknown: 'Такого билета больше нет',
  not_found: 'Событие не найдено',
  forbidden: 'Это может только организатор',
  events_limit: 'Бесплатные события закончились. Подписка для большего числа скоро появится',
  already_claimed: 'Это событие уже подтвердил организатор',
  unauthorized: 'Не получилось войти. Откройте приложение заново',
  invalid_input: 'Проверьте заполненные поля',
  phone_taken: 'Аккаунт с таким номером уже добавлен',
  not_expected: 'Сейчас аккаунт не ждёт кода или пароля',
  account_gone: 'Аккаунт, с которого шла переписка, удалён',
  no_account: 'Отправлять не с чего: добавьте аккаунт Telegram в «Аккаунты»',
  not_draft: 'Черновик уже отправлен или отклонён',
  not_delivered: 'Telegram не доставил сообщение: человек не открывал бота или заблокировал его',
};

export class ApiError extends Error {
  code: string;
  constructor(code: string) {
    super(MESSAGES[code] ?? 'Не получилось. Попробуйте ещё раз');
    this.code = code;
  }
}

async function request<T>(method: string, path: string, body?: unknown, keepalive = false): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { ...(authorization ? { authorization } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      keepalive, // запрос переживёт уход со страницы
    });
  } catch {
    throw new ApiError('network');
  }
  if (!res.ok) throw new ApiError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'internal');
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export type EventData = Wire<EventView>;
export type EventListData = Wire<EventListItem>;

export const api = {
  config: () => request<AppConfig>('GET', '/config'),
  me: () => request<Me>('GET', '/me'),
  inbox: () => request<Wire<InboxFeed>>('GET', '/admin/inbox'),
  overview: () => request<Wire<AdminOverview>>('GET', '/admin/overview'),
  inboxThread: (id: string) => request<Wire<Message>[]>('GET', `/admin/conversations/${id}/messages`),
  inboxSend: (id: string, text: string) => request<void>('POST', `/admin/conversations/${id}/messages`, { text }),
  draftSend: (id: string, text?: string) => request<void>('POST', `/admin/messages/${id}/send`, text ? { text } : {}),
  draftReject: (id: string) => request<void>('DELETE', `/admin/messages/${id}`),
  accountCreate: (input: AccountCreateInput) => request<Wire<TgAccount>>('POST', '/admin/accounts', input),
  accountLogin: (id: string, secret: string) => request<void>('POST', `/admin/accounts/${id}/login`, { secret }),
  accountDelete: (id: string) => request<void>('DELETE', `/admin/accounts/${id}`),
  adminEvents: () => request<AdminCollectedEvent[]>('GET', '/admin/collected-events'),
  adminEventModerate: (id: string, status: 'approved' | 'rejected') => request<{ status: string }>('PATCH', `/admin/collected-events/${encodeURIComponent(id)}`, { status }),
  adminEventDelete: (id: string) => request<void>('DELETE', `/admin/collected-events/${encodeURIComponent(id)}`),
  inboxUpdate: (id: string, input: ConversationUpdateInput) => request<Wire<Conversation>>('PATCH', `/admin/conversations/${id}`, input),
  logout: () => request<void>('POST', '/auth/logout'),
  collected: () => request<CollectedEventItem[]>('GET', '/collected-events'),
  collectedEvent: (id: string) => request<CollectedEventItem>('GET', `/collected-events/${encodeURIComponent(id)}`),
  claim: (id: string) => request<EventData>('POST', `/collected-events/${encodeURIComponent(id)}/claim`),
  signUp: (id: string) => request<CollectedEventItem>('POST', `/collected-events/${encodeURIComponent(id)}/signup`, undefined, true),
  visitCollected: (id: string) => request<void>('POST', `/collected-events/${encodeURIComponent(id)}/visit`, {} satisfies VisitInput),
  visit: (id: string, ref?: number) => request<void>('POST', `/events/${encodeURIComponent(id)}/visit`, { ref } satisfies VisitInput),
  events: () => request<EventListData[]>('GET', '/events'),
  myCollected: () => request<MyCollectedItem[]>('GET', '/me/collected'),
  event: (id: string) => request<EventData>('GET', `/events/${encodeURIComponent(id)}`),
  createEvent: (input: EventCreateInput) => request<EventData>('POST', '/events', input),
  updateEvent: (id: string, input: EventUpdateInput) => request<EventData>('PATCH', `/events/${encodeURIComponent(id)}`, input),
  rsvp: (id: string, input: RsvpInput) => request<EventData>('POST', `/events/${encodeURIComponent(id)}/rsvp`, input),
};
