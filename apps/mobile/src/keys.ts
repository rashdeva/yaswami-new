// Все ключи запросов.
export const keys = {
  me: ['me'] as const,
  feed: ['collected'] as const,
  collected: (id: string) => ['collected', id] as const,
  event: (id: string) => ['event', id] as const,
  mine: ['mine'] as const,
  hosts: ['hosts'] as const,
  host: (id: string) => ['host', id] as const,
  jobs: ['jobs'] as const,
  job: (id: string) => ['job', id] as const,
  search: (query: string) => ['search', query] as const,
};
