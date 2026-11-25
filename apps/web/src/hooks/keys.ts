// Ключи запросов TanStack Query — все здесь: по ним хуки находят и обновляют данные друг друга.
export const keys = {
  me: ['me'],
  config: ['config'],
  /** Города и город гостя без входа (у вошедшего он в `me`). */
  cities: ['cities'],
  guestCity: ['guest-city'],
  /** Темы (Topic): список живёт в базе. */
  topics: ['topics'],
  /** Витрина: собранные события города; `allCollected` — витрины всех городов разом. */
  allCollected: ['collected'],
  collected: (city: string) => ['collected', city],
  collectedEvent: (id: string) => ['collected-event', id],
  /** Витрина из полок (ADR-0009): полки города с их событиями. */
  showcase: (city: string) => ['showcase', city],
  /** Каталог организаторов и страница одного. */
  allHosts: ['hosts'],
  hosts: (city: string) => ['hosts', city],
  host: (id: string) => ['host', id],
  /** Вакансии: список страницами и карточка. */
  jobs: (city: string) => ['jobs', city],
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
