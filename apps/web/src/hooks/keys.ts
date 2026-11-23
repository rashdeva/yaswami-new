// Ключи запросов TanStack Query — все здесь: по ним хуки находят и обновляют данные друг друга.
export const keys = {
  me: ['me'],
  config: ['config'],
  /** Темы (Topic): список живёт в базе. */
  topics: ['topics'],
  /** Витрина: собранные события города. */
  collected: ['collected'],
  collectedEvent: (id: string) => ['collected-event', id],
  /** Каталог организаторов и страница одного. */
  hosts: ['hosts'],
  host: (id: string) => ['host', id],
  /** Вакансии: список страницами, «есть ли хоть одна» для входа в раздел и карточка. */
  jobs: ['jobs'],
  jobsExist: ['jobs', 'exist'],
  job: (id: string) => ['job', id],
  /** Единый поиск по каталогу. */
  search: (query: string) => ['search', query],
  /** «Мои события»: свои и собранные, куда заходил. */
  mine: ['mine'],
  event: (id: string) => ['event', id],
  /** Запросы организатора и Находки по ним. */
  hostSearches: ['host-searches'],
  hostSearchMatches: ['host-search-matches'],
} as const;
