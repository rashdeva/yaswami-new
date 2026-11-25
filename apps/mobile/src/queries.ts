// Данные экранов: useQuery на чтение, useMutation на изменение. Экран зовёт хук, api.* видит только этот файл.
import { useRef } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { CollectedEventItem, Me, ProductCategory, ProductList, RsvpInput, Wire } from '@yaswami/core';
import { collectedDayKey, DEFAULT_CITY_ID, PRODUCTS_MIN_HOSTS, setTopics, TOPIC_GUIDES } from '@yaswami/core';
import { api } from './api';
import { keys } from './keys';
import { useSession } from './session';

/**
 * Темы в порядке фильтров. Список живёт в базе; до ответа сервера — темы из сборки. Ответ кладётся в реестр ядра
 * (TOPIC_GUIDES): по нему находятся гид, эмодзи и иконка. Экран, который их показывает, зовёт этот хук.
 */
export function useTopics(): string[] {
  useQuery({ queryKey: keys.topics, queryFn: async () => { const topics = await api.topics(); setTopics(topics); return topics; }, staleTime: 5 * 60_000 });
  return Object.keys(TOPIC_GUIDES);
}

/**
 * Город, чью витрину, мастеров, товары и поиск показывает приложение: город вошедшего (`me.city_id`, выбирается
 * в мини-приложении), иначе первый. ponytail: своего выбора города в приложении нет, пока оно только для Вьетнама.
 */
function useCityId(): string {
  return useSession().me?.city_id ?? DEFAULT_CITY_ID;
}

/** Витрина, разбитая по дням: список уже отсортирован по началу. */
export function useFeed() {
  const city = useCityId();
  const q = useQuery({ queryKey: keys.feed(city), queryFn: () => api.collected(city) });
  const days: { key: string; data: CollectedEventItem[] }[] = [];
  for (const item of q.data ?? []) {
    const key = collectedDayKey(item.starts_at);
    if (days.at(-1)?.key === key) days.at(-1)!.data.push(item);
    else days.push({ key, data: [item] });
  }
  return { ...q, days };
}

export function useCollected(id: string) {
  const client = useQueryClient();
  // Карточка из витрины — сразу, пока грузятся организатор и подробности.
  const q = useQuery({
    queryKey: keys.collected(id),
    queryFn: () => api.collectedEvent(id),
    placeholderData: () => client.getQueriesData<CollectedEventItem[]>({ queryKey: ['feed'] }).flatMap(([, list]) => list ?? []).find((e) => e.id === id),
  });
  const signUp = useMutation({
    mutationFn: () => api.signUp(id),
    onSuccess: () => {
      client.setQueryData<Me | null>(keys.me, (m) => m && { ...m, collected_signups: [...new Set([...m.collected_signups, id])] });
      void client.invalidateQueries({ queryKey: keys.mine });
    },
  });
  return { ...q, signUp: signUp.mutate };
}

export function useEvent(id: string) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: keys.event(id), queryFn: () => api.event(id) });
  const rsvp = useMutation({
    mutationFn: (input: RsvpInput) => api.rsvp(id, input),
    onSuccess: (view) => {
      client.setQueryData(keys.event(id), view);
      void client.invalidateQueries({ queryKey: keys.mine });
    },
  });
  return { ...q, rsvp: rsvp.mutateAsync, answering: rsvp.isPending };
}

/** «Мои»: события Ясвами, где человек гость или организатор, и собранные, куда он записывался. */
export function useMine(enabled: boolean) {
  return useQuery({
    queryKey: keys.mine,
    queryFn: async () => {
      const [events, collected] = await Promise.all([api.events(), api.myCollected()]);
      return { events, collected: collected.filter((c) => c.signed_up).map((c) => c.event) };
    },
    enabled,
  });
}

export function useHosts() {
  const city = useCityId();
  return useQuery({ queryKey: keys.hosts(city), queryFn: () => api.hosts(city) });
}
export const useHost = (id: string) => useQuery({ queryKey: keys.host(id), queryFn: () => api.host(id) });

/** Товары мастеров города страницами, свежие сверху; `category` null — все; `categories` — где в городе есть товары. */
export function useProducts(category: ProductCategory | null) {
  const city = useCityId();
  const q = useInfiniteQuery({
    queryKey: keys.products(city, category ?? 'all'),
    queryFn: ({ pageParam }) => api.products({ city_id: city, category: category ?? undefined, pagination_cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.has_more ? last.next_cursor ?? undefined : undefined),
  });
  // Категории города не зависят от выбранной: пока грузится новая плашка, держим прежний список, иначе плашки мигают.
  const known = useRef<ProductCategory[]>([]);
  const categories = q.data?.pages[0]?.categories ?? known.current;
  known.current = categories;
  return { ...q, products: q.data?.pages.flatMap((p) => p.entries) ?? [], categories };
}

export function useProduct(id: string) {
  const client = useQueryClient();
  // Карточка из списка — сразу, пока грузится сам товар.
  return useQuery({
    queryKey: keys.product(id),
    queryFn: () => api.product(id),
    placeholderData: () =>
      client.getQueriesData<InfiniteData<Wire<ProductList>>>({ queryKey: ['products'] }).flatMap(([, d]) => d?.pages.flatMap((p) => p.entries) ?? []).find((p) => p.id === id),
  });
}

/** Показывать ли вкладку «Товары»: товары хотя бы у PRODUCTS_MIN_HOSTS мастеров города. Нужен только `hosts_count` — берём одну строку. */
export function useProductsTab(): boolean {
  const city = useCityId();
  const { data } = useQuery({
    queryKey: keys.productsHosts(city),
    queryFn: async () => (await api.products({ city_id: city, pagination_limit: 1 })).hosts_count,
    staleTime: 10 * 60_000,
  });
  return (data ?? 0) >= PRODUCTS_MIN_HOSTS;
}

/** Поиск начинается с двух букв — так же проверяет сервер. */
export function useSearch(query: string) {
  const q = query.trim();
  const city = useCityId();
  return useQuery({ queryKey: keys.search(q, city), queryFn: () => api.search(q, city), enabled: q.length >= 2, placeholderData: (prev) => prev });
}
