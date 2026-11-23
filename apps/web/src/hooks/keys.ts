// Ключи запросов TanStack Query — все здесь: по ним хуки находят и обновляют данные друг друга.
export const keys = {
  me: ['me'],
  config: ['config'],
  /** Города и город гостя без входа (у вошедшего он в `me`). */
  cities: ['cities'],
  guestCity: ['guest-city'],
  /** Темы (Topic): список живёт в базе. */
  topics: ['topics'],
  /** Витрина: собранные события города. `['collected']` — витрины всех городов разом. */
  collected: (city: string) => ['collected', city],
  collectedEvent: (id: string) => ['collected-event', id],
  /** Каталог организаторов и страница одного. */
  hosts: (city: string) => ['hosts', city],
  host: (id: string) => ['host', id],
  /** Вакансии: список страницами, «есть ли хоть одна» для входа в раздел и карточка. */
  jobs: (city: string) => ['jobs', city],
  jobsExist: (city: string) => ['jobs-exist', city],
  job: (id: string) => ['job', id],
  /** Единый поиск по каталогу. */
  search: (query: string, city: string) => ['search', city, query],
  /** «Мои события»: свои и собранные, куда заходил. */
  mine: ['mine'],
  event: (id: string) => ['event', id],
  /** Запросы организатора и Находки по ним. */
  hostSearches: ['host-searches'],
  hostSearchMatches: ['host-search-matches'],
} as const;
