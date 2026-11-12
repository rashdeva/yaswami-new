// Клиент API админки: единственное место, где есть fetch. Формы запросов и ответов — из @yaswami/core.
import type {
  AccountCreateInput, AccountUpdateInput, AdminAction, AdminActionList, AdminActionListInput, AdminCollectedEvent, AdminCollectedEventView, AdminContact,
  AdminEventCreateInput, AdminEventItem, AdminEventListInput, AdminEventView, AdminFeedback, AdminGuest, AdminGuestUpdateInput, AdminHostView, AdminOverview,
  AdminUserView, CollectedStatus, CollectedUpdateInput, Conversation, ConversationUpdateInput, EventUpdateInput, EventView, Host, HostUpdateInput, InboxConversation,
  InboxFeed, Message, TgAccount, TicketType, TicketTypeCreateInput, TicketTypeUpdateInput, User, UserUpdateInput, Wire,
} from '@yaswami/core';

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
  changed_since: 'Отменить нельзя: с тех пор запись меняли, отмена затёрла бы ту правку',
  already_undone: 'Это действие уже отменено',
  not_undoable: 'Это действие не отменяется: оно ушло в Telegram, потратило деньги или касалось входа',
  user_has_events: 'У пользователя есть свои события: сначала удалите их или передайте',
  user_not_found: 'Такого пользователя нет',
  plus_one_off: 'На этом событии нельзя брать «+1»',
  full: 'Мест нет: событие или этот тип билета заполнен',
  closed: 'Событие закрыто для ответов: отменено или уже прошло',
  ticket_required: 'Выберите тип билета',
  ticket_unknown: 'Такого типа билета у события нет',
  ticket_type_in_use: 'Этот тип билета уже у гостей: сначала переведите их на другой',
  ticket_type_last: 'Это последний тип билета: у события должен остаться хотя бы один',
  ticket_type_last_visible: 'Это последний видимый тип билета: гостям нечего будет выбрать',
  events_limit: 'У организатора кончились бесплатные события',
  video_exists: 'Ролик у события уже есть',
  video_limit: 'Лимит роликов на сегодня исчерпан',
  illustrator_off: 'Иллюстратор не подключён: ролик заказать не у кого',
  not_approved: 'Сначала одобрите событие',
  bad_image_url: 'Картинку можно взять только из хранилища xAI (files-cdn.x.ai, imgen.x.ai)',
  bad_image: 'По ссылке не картинка или она слишком большая',
};

export type Issue = { path?: (string | number)[]; message?: string };

export class ApiError extends Error {
  code: string;
  /** Ошибки полей при `invalid_input`. */
  issues?: Issue[];
  constructor(code: string, issues?: Issue[]) {
    super(MESSAGES[code] ?? 'Не получилось. Попробуйте ещё раз');
    this.code = code;
    this.issues = issues;
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
  if (!res.ok) {
    const { error, issues } = (await res.json().catch(() => ({}))) as { error?: string; issues?: Issue[] };
    throw new ApiError(error ?? 'internal', issues);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Строка запроса без пустых значений; URLSearchParams кодирует `+` в смещении даты. */
const qs = (params: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams(Object.entries(params).filter((e): e is [string, string | number] => e[1] !== undefined && e[1] !== '').map(([k, v]) => [k, String(v)])).toString();
  return s ? `?${s}` : '';
};

export type Feed = Wire<InboxFeed>;
export type Conv = Wire<InboxConversation>;
export type Msg = Wire<Message>;
export type Account = Wire<TgAccount>;
/** Собранное событие, которое ждёт решения иллюстратора; типа в core нет (см. listPendingCovers в apps/api/src/services.ts). */
export type Cover = { id: string; title: string; description: string; topic: string | null; tags: string[]; place: string | null; photo_url: string | null };

const id = encodeURIComponent;

export const api = {
  logout: () => request<void>('POST', '/auth/logout'),
  overview: () => request<Wire<AdminOverview>>('GET', '/admin/overview'),

  // Переписка
  inbox: () => request<Feed>('GET', '/admin/inbox'),
  inboxThread: (conversation: string) => request<Msg[]>('GET', `/admin/conversations/${id(conversation)}/messages`),
  inboxSend: (conversation: string, text: string) => request<void>('POST', `/admin/conversations/${id(conversation)}/messages`, { text }),
  inboxUpdate: (conversation: string, input: ConversationUpdateInput) => request<Wire<Conversation>>('PATCH', `/admin/conversations/${id(conversation)}`, input),
  draftSend: (message: string, text?: string) => request<void>('POST', `/admin/messages/${id(message)}/send`, text ? { text } : {}),
  draftUpdate: (message: string, text: string) => request<Msg>('PATCH', `/admin/messages/${id(message)}`, { text }),
  draftReject: (message: string) => request<void>('DELETE', `/admin/messages/${id(message)}`),

  // Аккаунты Telegram
  accounts: () => request<Account[]>('GET', '/admin/accounts'),
  accountCreate: (input: AccountCreateInput) => request<Account>('POST', '/admin/accounts', input),
  accountUpdate: (account: string, input: AccountUpdateInput) => request<Account>('PATCH', `/admin/accounts/${id(account)}`, input),
  accountLogin: (account: string, secret: string) => request<void>('POST', `/admin/accounts/${id(account)}/login`, { secret }),
  accountDelete: (account: string) => request<void>('DELETE', `/admin/accounts/${id(account)}`),

  // События Ясвами
  events: (input: AdminEventListInput) => request<Wire<AdminEventItem>[]>('GET', `/admin/events${qs(input)}`),
  eventCreate: (input: AdminEventCreateInput) => request<Wire<EventView>>('POST', '/admin/events', input),
  event: (event: string) => request<Wire<AdminEventView>>('GET', `/admin/events/${id(event)}`),
  eventUpdate: (event: string, input: EventUpdateInput) => request<Wire<EventView>>('PATCH', `/admin/events/${id(event)}`, input),
  eventDelete: (event: string) => request<void>('DELETE', `/admin/events/${id(event)}`),
  guests: (event: string) => request<Wire<AdminGuest>[]>('GET', `/admin/events/${id(event)}/guests`),
  guestUpdate: (event: string, user: number, input: AdminGuestUpdateInput) => request<Wire<EventView>>('PUT', `/admin/events/${id(event)}/guests/${user}`, input),
  guestRemove: (event: string, user: number) => request<void>('DELETE', `/admin/events/${id(event)}/guests/${user}`),
  ticketTypeCreate: (event: string, input: TicketTypeCreateInput) => request<TicketType>('POST', `/admin/events/${id(event)}/ticket-types`, input),
  ticketTypeUpdate: (ticketType: string, input: TicketTypeUpdateInput) => request<TicketType>('PATCH', `/admin/ticket-types/${id(ticketType)}`, input),
  ticketTypeDelete: (ticketType: string) => request<void>('DELETE', `/admin/ticket-types/${id(ticketType)}`),
  feedback: (event: string) => request<Wire<AdminFeedback>[]>('GET', `/admin/events/${id(event)}/feedback`),
  feedbackDelete: (event: string, user: number) => request<void>('DELETE', `/admin/events/${id(event)}/feedback/${user}`),

  // Собранные события
  collectedEvents: (status?: CollectedStatus) => request<AdminCollectedEvent[]>('GET', `/admin/collected-events${qs({ status })}`),
  collectedEvent: (event: string) => request<Wire<AdminCollectedEventView>>('GET', `/admin/collected-events/${id(event)}`),
  collectedUpdate: (event: string, input: CollectedUpdateInput) => request<AdminCollectedEvent>('PATCH', `/admin/collected-events/${id(event)}`, input),
  collectedDelete: (event: string) => request<void>('DELETE', `/admin/collected-events/${id(event)}`),
  covers: () => request<Cover[]>('GET', '/admin/covers'),
  coverSet: (event: string, image_url?: string) => request<{ cover_url: string | null }>('POST', `/admin/covers/${id(event)}`, image_url ? { image_url } : {}),
  videoRequest: (event: string) => request<unknown>('POST', `/admin/videos/${id(event)}`),

  // Организаторы
  hosts: () => request<Wire<Host>[]>('GET', '/admin/hosts'),
  host: (host: string) => request<Wire<AdminHostView>>('GET', `/admin/hosts/${id(host)}`),
  hostUpdate: (host: string, input: HostUpdateInput) => request<Wire<Host>>('PATCH', `/admin/hosts/${id(host)}`, input),
  hostDelete: (host: string) => request<void>('DELETE', `/admin/hosts/${id(host)}`),

  // Пользователи и контакты
  users: (query?: string) => request<User[]>('GET', `/admin/users${qs({ query })}`),
  user: (user: number) => request<Wire<AdminUserView>>('GET', `/admin/users/${user}`),
  userUpdate: (user: number, input: UserUpdateInput) => request<User>('PATCH', `/admin/users/${user}`, input),
  userDelete: (user: number) => request<void>('DELETE', `/admin/users/${user}`),
  userTokensRevoke: (user: number) => request<void>('DELETE', `/admin/users/${user}/tokens`),
  contacts: (hostUser?: number) => request<Wire<AdminContact>[]>('GET', `/admin/contacts${qs({ host_user_id: hostUser })}`),
  contactDelete: (contact: string) => request<void>('DELETE', `/admin/contacts/${id(contact)}`),

  // Журнал
  actions: (input: AdminActionListInput) => request<Wire<AdminActionList>>('GET', `/admin/actions${qs(input)}`),
  action: (action: string) => request<Wire<AdminAction>>('GET', `/admin/actions/${id(action)}`),
  actionUndo: (action: string) => request<Wire<AdminAction>>('POST', `/admin/actions/${id(action)}/undo`),
};
