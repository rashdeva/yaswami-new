// Клиент API. Формы запросов и ответов — из @yaswami/core, те же, что проверяет бэк.
import type { EventCreateInput, EventListItem, EventView, RsvpInput, Wire } from '@yaswami/core';
import { inTelegram, tg } from './tg.ts';

const BASE = import.meta.env.VITE_API_URL ?? '/api';
const devToken = import.meta.env.DEV ? import.meta.env.VITE_DEV_TOKEN : undefined;
const authorization = inTelegram ? `tma ${tg!.initData}` : devToken ? `Bearer ${devToken}` : null;

/** Есть чем представиться: открыты в Telegram или задан токен разработчика. */
export const canAuth = authorization !== null;

const MESSAGES: Record<string, string> = {
  full: 'Свободных мест больше нет',
  closed: 'Событие закрыто для ответов',
  ticket_required: 'Выберите билет',
  ticket_unknown: 'Такого билета больше нет',
  not_found: 'Событие не найдено',
  forbidden: 'Это может только организатор',
  unauthorized: 'Не получилось войти. Откройте приложение заново',
  invalid_input: 'Проверьте заполненные поля',
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
      headers: { ...(authorization ? { authorization } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('network');
  }
  if (!res.ok) throw new ApiError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'internal');
  return (await res.json()) as T;
}

export type EventData = Wire<EventView>;
export type EventListData = Wire<EventListItem>;

export const api = {
  events: () => request<EventListData[]>('GET', '/events'),
  event: (id: string) => request<EventData>('GET', `/events/${encodeURIComponent(id)}`),
  createEvent: (input: EventCreateInput) => request<EventData>('POST', '/events', input),
  rsvp: (id: string, input: RsvpInput) => request<EventData>('POST', `/events/${encodeURIComponent(id)}/rsvp`, input),
};
