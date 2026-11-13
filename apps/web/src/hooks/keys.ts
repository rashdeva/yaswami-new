// Ключи запросов TanStack Query — все здесь: по ним хуки находят и обновляют данные друг друга.
export const keys = {
  me: ['me'],
  config: ['config'],
  /** Витрина: собранные события города. */
  collected: ['collected'],
  collectedEvent: (id: string) => ['collected-event', id],
  /** Каталог организаторов и страница одного. */
  hosts: ['hosts'],
  host: (id: string) => ['host', id],
  /** «Мои события»: свои и собранные, куда заходил. */
  mine: ['mine'],
  event: (id: string) => ['event', id],
} as const;
