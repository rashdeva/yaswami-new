// Клиент API. Формы запросов и ответов — из @yaswami/core, те же, что проверяет бэк.
import type { AppConfig, City, CollectedEventItem, Contact, EventCreateInput, HostSelf, HostSelfUpdateInput, HostItem, HostListItem, HostSearch, HostSearchCreateInput, HostSearchList, HostSearchMatchList, HostSearchUpdateInput, EventListItem, EventUpdateInput, EventView, Me, MyCollectedItem, PracticeSignup, ProductItem, ProductList, ProductListInput, RsvpInput, SearchResult, Showcase, SourceAddInput, SourceSubmission, TopicItem, UserSelfUpdateInput, VisitInput, Wire } from '@yaswami/core';
import { track } from './analytics.ts';
import { inTelegram, siteArrival, tg } from './tg.ts';

const BASE = import.meta.env.VITE_API_URL ?? '/api';
const devToken = import.meta.env.DEV ? import.meta.env.VITE_DEV_TOKEN : undefined;
const authorization = inTelegram ? `tma ${tg!.initData}` : devToken ? `Bearer ${devToken}` : null;

/** Вход известен сразу: открыты в Telegram или задан токен разработчика. Иначе — только cookie сайта, если она есть. */
export const hasCredentials = authorization !== null;

/** Уводит на вход через Telegram; после входа человек вернётся на `back`. */
export function startLogin(back: string) {
  track('login_started', { back });
  // start — с какой ссылкой пришёл на сайт: если человек новый, это станет его приходом (видно команде в «Активности»).
  location.href = `${BASE}/auth/telegram/login?return=${encodeURIComponent(back)}${siteArrival ? `&start=${encodeURIComponent(siteArrival)}` : ''}`;
}

const MESSAGES: Record<string, string> = {
  full: 'Свободных мест больше нет',
  closed: 'Событие закрыто для ответов',
  ticket_required: 'Выберите билет',
  ticket_unknown: 'Такого билета больше нет',
  not_found: 'Событие не найдено',
  product_not_found: 'Товар не найден', // бэк отвечает общим not_found — getProduct подменяет код, чтобы текст был про товар
  forbidden: 'Это может только организатор',
  feature_off: 'Создавать события пока могут только организаторы',
  events_limit: 'Бесплатные события закончились. Подписка для большего числа скоро появится',
  already_claimed: 'Это событие уже подтвердил организатор',
  unauthorized: 'Не получилось войти. Откройте приложение заново',
  invalid_input: 'Проверьте заполненные поля',
  too_many_requests: 'Слишком много запросов. Подождите минуту',
  not_host: 'Это доступно организаторам каталога',
  sources_limit: 'За сутки можно предложить три канала. Остальные пришлите завтра',
  source_exists: 'Этот канал у нас уже есть или мы его уже смотрели',
  not_a_channel: 'Это группа или чат, а мы читаем только каналы',
  channel_not_found: 'Такого публичного канала в Telegram нет. Проверьте username',
  city_not_found: 'Такого города у нас нет',
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
  listTopics: () => request<TopicItem[]>('GET', '/topics'),
  cities: () => request<Wire<City>[]>('GET', '/cities'),
  me: () => request<Me>('GET', '/me'),
  updateSelf: (input: UserSelfUpdateInput) => request<Me>('PATCH', '/me', input),
  logout: () => request<void>('POST', '/auth/logout'),
  collected: (city_id: string) => request<CollectedEventItem[]>('GET', `/collected-events?city_id=${encodeURIComponent(city_id)}`),
  showcase: (city_id: string) => request<Showcase>('GET', `/showcase?city_id=${encodeURIComponent(city_id)}`),
  collectedEvent: (id: string) => request<CollectedEventItem>('GET', `/collected-events/${encodeURIComponent(id)}`),
  listHosts: (city_id: string) => request<HostListItem[]>('GET', `/hosts?city_id=${encodeURIComponent(city_id)}`),
  getHost: (id: string) => request<HostItem>('GET', `/hosts/${encodeURIComponent(id)}`),
  search: (query: string, city_id: string) => request<Wire<SearchResult>>('GET', `/search?query=${encodeURIComponent(query)}&city_id=${encodeURIComponent(city_id)}`),
  listProducts: ({ city_id, category, pagination_cursor, pagination_limit }: ProductListInput = {}) =>
    request<Wire<ProductList>>('GET', `/products?${new URLSearchParams(Object.entries({ city_id, category, pagination_cursor, pagination_limit }).flatMap(([k, v]) => (v === undefined ? [] : [[k, String(v)]])))}`),
  getProduct: (id: string) =>
    request<Wire<ProductItem>>('GET', `/products/${encodeURIComponent(id)}`).catch((e: ApiError) => { throw e.code === 'not_found' ? new ApiError('product_not_found') : e; }),
  getHostSelf: () => request<HostSelf>('GET', '/me/host'),
  updateHostSelf: (input: HostSelfUpdateInput) => request<HostSelf>('PATCH', '/me/host', input),
  signUpForPractice: (id: string, practice_id: string) => request<PracticeSignup>('POST', `/hosts/${encodeURIComponent(id)}/practices/signup`, { practice_id }, true),
  claim: (id: string) => request<EventData>('POST', `/collected-events/${encodeURIComponent(id)}/claim`),
  signUp: (id: string) => request<CollectedEventItem>('POST', `/collected-events/${encodeURIComponent(id)}/signup`, undefined, true),
  visitCollected: (id: string) => request<void>('POST', `/collected-events/${encodeURIComponent(id)}/visit`, {} satisfies VisitInput),
  visit: (id: string, ref?: number) => request<void>('POST', `/events/${encodeURIComponent(id)}/visit`, { ref } satisfies VisitInput),
  events: () => request<EventListData[]>('GET', '/events'),
  contacts: () => request<{ entries: Wire<Contact>[] }>('GET', '/contacts'),
  myCollected: () => request<MyCollectedItem[]>('GET', '/me/collected'),
  event: (id: string) => request<EventData>('GET', `/events/${encodeURIComponent(id)}`),
  createEvent: (input: EventCreateInput) => request<EventData>('POST', '/events', input),
  updateEvent: (id: string, input: EventUpdateInput) => request<EventData>('PATCH', `/events/${encodeURIComponent(id)}`, input),
  rsvp: (id: string, input: RsvpInput) => request<EventData>('POST', `/events/${encodeURIComponent(id)}/rsvp`, input),
  addSource: (input: SourceAddInput) => request<SourceSubmission>('POST', '/sources', input),
  listHostSearches: () => request<Wire<HostSearchList>>('GET', '/host-searches'),
  createHostSearch: (input: HostSearchCreateInput) => request<Wire<HostSearch>>('POST', '/host-searches', input),
  updateHostSearch: (id: string, input: HostSearchUpdateInput) => request<Wire<HostSearch>>('PATCH', `/host-searches/${encodeURIComponent(id)}`, input),
  deleteHostSearch: (id: string) => request<void>('DELETE', `/host-searches/${encodeURIComponent(id)}`),
  listHostSearchMatches: () => request<Wire<HostSearchMatchList>>('GET', '/host-searches/matches'),
};
