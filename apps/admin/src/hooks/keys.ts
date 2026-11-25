// Ключи запросов TanStack Query — все здесь: по ним хуки находят и обновляют данные друг друга.
import type { AdminActionListInput } from '@yaswami/core';

export const keys = {
  /** Лента переписки: диалоги, последние сообщения, аккаунты. */
  inbox: ['inbox'],
  thread: (conversation: string) => ['thread', conversation],
  /** Кто сейчас пишет: его кладёт поток `/admin/live`, а не запрос. */
  live: ['live'],
  /** Разделы «Организаторы» и «Агенты»; `newest` — последнее сообщение ленты, с ним сводка перечитывается. */
  overview: (newest?: string) => ['overview', newest],
  events: (filter: object) => ['events', filter],
  event: (id: string) => ['event', id],
  guests: (event: string) => ['event', event, 'guests'],
  feedback: (event: string) => ['event', event, 'feedback'],
  collectedEvents: (past = false) => ['collected-events', past],
  collectedEvent: (id: string) => ['collected-event', id],
  covers: ['covers'],
  hosts: ['hosts'],
  host: (id: string) => ['host', id],
  products: (filter: object) => ['products', filter],
  users: (query?: string) => ['users', query],
  user: (id: number) => ['user', id],
  contacts: (hostUser: number) => ['contacts', hostUser],
  actions: (filter: Omit<AdminActionListInput, 'pagination_cursor'>) => ['actions', filter],
  action: (id: string) => ['action', id],
  sources: ['sources'],
  sourceSearches: (city: string) => ['source-searches', city],
  topics: ['topics'],
  topicCandidates: ['topics', 'candidates'],
  cities: ['cities'],
  /** Полки витрины города и его предстоящие события (для ручной полки). */
  shelves: (city: string) => ['shelves', city],
  cityEvents: (city: string) => ['city-events', city],
} as const;
