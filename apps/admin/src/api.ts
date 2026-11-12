// Клиент API админки: единственное место, где есть fetch. Формы запросов и ответов — из @yaswami/core.
import type { AccountCreateInput, AdminCollectedEvent, AdminOverview, CollectedUpdateInput, Conversation, ConversationUpdateInput, InboxConversation, InboxFeed, Message, TgAccount, Wire } from '@yaswami/core';

const BASE = import.meta.env.VITE_API_URL ?? '/api';
// Вход — cookie сайта; в разработке вместо неё токен админа из .env.
const devToken = import.meta.env.DEV ? import.meta.env.VITE_DEV_TOKEN : undefined;

/** Адрес входа на сайте через Telegram; после входа человек вернётся на `back`. */
export const loginUrl = (back: string) => `${BASE}/auth/telegram/login?return=${encodeURIComponent(back)}`;

const MESSAGES: Record<string, string> = {
  unauthorized: 'Вход истёк. Обновите страницу и войдите заново',
  forbidden: 'У этого аккаунта нет доступа к админке',
  not_found: 'Не найдено: возможно, это уже удалили',
  invalid_input: 'Проверьте заполненные поля',
  network: 'Нет связи с сервером',
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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { ...(devToken ? { authorization: `Bearer ${devToken}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('network');
  }
  if (!res.ok) throw new ApiError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'internal');
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export type Feed = Wire<InboxFeed>;
export type Conv = Wire<InboxConversation>;
export type Msg = Wire<Message>;
export type Account = Wire<TgAccount>;

const id = encodeURIComponent;

export const api = {
  logout: () => request<void>('POST', '/auth/logout'),
  inbox: () => request<Feed>('GET', '/admin/inbox'),
  overview: () => request<Wire<AdminOverview>>('GET', '/admin/overview'),
  inboxThread: (conversation: string) => request<Msg[]>('GET', `/admin/conversations/${id(conversation)}/messages`),
  inboxSend: (conversation: string, text: string) => request<void>('POST', `/admin/conversations/${id(conversation)}/messages`, { text }),
  inboxUpdate: (conversation: string, input: ConversationUpdateInput) => request<Wire<Conversation>>('PATCH', `/admin/conversations/${id(conversation)}`, input),
  draftSend: (message: string, text?: string) => request<void>('POST', `/admin/messages/${id(message)}/send`, text ? { text } : {}),
  draftReject: (message: string) => request<void>('DELETE', `/admin/messages/${id(message)}`),
  accountCreate: (input: AccountCreateInput) => request<Account>('POST', '/admin/accounts', input),
  accountLogin: (account: string, secret: string) => request<void>('POST', `/admin/accounts/${id(account)}/login`, { secret }),
  accountDelete: (account: string) => request<void>('DELETE', `/admin/accounts/${id(account)}`),
  adminEvents: () => request<Wire<AdminCollectedEvent>[]>('GET', '/admin/collected-events'),
  adminEventUpdate: (event: string, input: CollectedUpdateInput) => request<Wire<AdminCollectedEvent>>('PATCH', `/admin/collected-events/${id(event)}`, input),
  adminEventRedo: (event: string) => request<void>('POST', `/admin/collected-events/${id(event)}/redo`),
  adminEventDelete: (event: string) => request<void>('DELETE', `/admin/collected-events/${id(event)}`),
};
