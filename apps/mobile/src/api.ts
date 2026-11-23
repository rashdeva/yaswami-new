// Клиент API. Формы запросов и ответов — из @yaswami/core, те же, что проверяет бэк. Как apps/web/src/api.ts, только
// вход — Bearer-токен из защищённого хранилища устройства, а не initData или cookie.
import * as SecureStore from 'expo-secure-store';
import type { TopicItem, CollectedEventItem, EventListItem, EventView, HostItem, HostListItem, JobItem, JobList, Me, MyCollectedItem, RsvpInput, SearchResult, Wire } from '@yaswami/core';

export const SITE = process.env.EXPO_PUBLIC_SITE_URL ?? 'https://yaswami.com';
export const BASE = `${SITE}/api`;
/** Схема из app.json: сюда сервер возвращает человека после входа через Telegram. */
export const AUTH_REDIRECT = 'app.yaswami://auth';

const TOKEN_KEY = 'ysw_token';
let token: string | null = SecureStore.getItem(TOKEN_KEY);
export const hasToken = () => token !== null;
export async function setToken(value: string | null) {
  token = value;
  await (value ? SecureStore.setItemAsync(TOKEN_KEY, value) : SecureStore.deleteItemAsync(TOKEN_KEY));
}

const MESSAGES: Record<string, string> = {
  network: 'Нет связи с сервером. Проверьте интернет',
  full: 'Свободных мест больше нет',
  closed: 'Событие закрыто для ответов',
  ticket_required: 'Выберите билет',
  ticket_unknown: 'Такого билета больше нет',
  not_found: 'Не нашли — возможно, его уже убрали',
  forbidden: 'Это может только организатор',
  unauthorized: 'Войдите, чтобы продолжить',
  invalid_token: 'Вход не подтвердился. Попробуйте ещё раз',
  expired: 'Вход занял слишком долго. Попробуйте ещё раз',
  telegram_failed: 'Telegram не подтвердил вход',
  not_configured: 'Этот способ входа сейчас недоступен',
  invalid_input: 'Проверьте заполненные поля',
  too_many_requests: 'Слишком много запросов. Подождите минуту',
};

export class ApiError extends Error {
  constructor(public code: string) {
    super(MESSAGES[code] ?? 'Не получилось. Попробуйте ещё раз');
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('network');
  }
  if (!res.ok) throw new ApiError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'internal');
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const id = encodeURIComponent;

export const api = {
  topics: () => request<TopicItem[]>('GET', '/topics'),
  me: () => request<Me>('GET', '/me'),
  loginApple: (id_token: string, first_name?: string) => request<{ token: string }>('POST', '/auth/apple', { id_token, first_name }),
  loginGoogle: (id_token: string) => request<{ token: string }>('POST', '/auth/google', { id_token }),
  deleteMe: () => request<void>('DELETE', '/me'),
  collected: () => request<CollectedEventItem[]>('GET', '/collected-events'),
  collectedEvent: (cid: string) => request<CollectedEventItem>('GET', `/collected-events/${id(cid)}`),
  signUp: (cid: string) => request<CollectedEventItem>('POST', `/collected-events/${id(cid)}/signup`),
  event: (eid: string) => request<Wire<EventView>>('GET', `/events/${id(eid)}`),
  events: () => request<Wire<EventListItem>[]>('GET', '/events'),
  myCollected: () => request<MyCollectedItem[]>('GET', '/me/collected'),
  rsvp: (eid: string, input: RsvpInput) => request<Wire<EventView>>('POST', `/events/${id(eid)}/rsvp`, input),
  hosts: () => request<HostListItem[]>('GET', '/hosts'),
  host: (hid: string) => request<HostItem>('GET', `/hosts/${id(hid)}`),
  jobs: () => request<Wire<JobList>>('GET', '/jobs'),
  job: (jid: string) => request<Wire<JobItem>>('GET', `/jobs/${id(jid)}`),
  search: (query: string) => request<Wire<SearchResult>>('GET', `/search?query=${id(query)}`),
};
