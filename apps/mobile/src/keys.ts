// Все ключи запросов.
export const keys = {
  me: ['me'] as const,
  topics: ['topics'] as const,
  feed: (city: string) => ['feed', city] as const,
  collected: (id: string) => ['collected', id] as const,
  event: (id: string) => ['event', id] as const,
  mine: ['mine'] as const,
  hosts: (city: string) => ['hosts', city] as const,
  host: (id: string) => ['host', id] as const,
  products: (city: string, category: string) => ['products', city, category] as const,
  productsHosts: (city: string) => ['products-hosts', city] as const,
  product: (id: string) => ['product', id] as const,
  search: (query: string, city: string) => ['search', city, query] as const,
};
