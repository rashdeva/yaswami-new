// Ключи запросов TanStack Query — все здесь: по ним хуки находят и обновляют данные друг друга.
export const keys = {
  /** Лента переписки: диалоги, последние сообщения, аккаунты. */
  inbox: ['inbox'],
  thread: (conversation: string) => ['thread', conversation],
  /** Разделы «Организаторы» и «Агенты»; `newest` — последнее сообщение ленты, с ним сводка перечитывается. */
  overview: (newest?: string) => ['overview', newest],
  collectedEvents: ['collected-events'],
  sources: ['sources'],
} as const;
