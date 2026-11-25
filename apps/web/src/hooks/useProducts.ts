import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useState } from 'react';
import type { ProductCategory, ProductItem, ProductList, Wire } from '@yaswami/core';
import { PRODUCTS_MIN_HOSTS } from '@yaswami/core';
import { track } from '../analytics.ts';
import { api } from '../api.ts';
import { openExternal } from '../tg.ts';
import { keys } from './keys.ts';
import { useCity } from './useSession.ts';

/**
 * Товары мастеров города, свежие сверху, страницами. `category` — переключатель «Все / Еда / Хендмейд» (null — все);
 * `more` — подгрузить следующую страницу, null — больше нет.
 */
export function useProducts() {
  const { city_id } = useCity();
  const [category, pick] = useState<ProductCategory | null>(null);
  const { data, error, hasNextPage, isFetchingNextPage, fetchNextPage } = useInfiniteQuery({
    queryKey: keys.products(city_id, category ?? 'all'),
    queryFn: ({ pageParam }) => api.listProducts({ city_id, category: category ?? undefined, pagination_cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.has_more ? last.next_cursor ?? undefined : undefined),
  });
  const setCategory = (next: ProductCategory | null) => {
    if (next) track('products_filtered', { category: next });
    pick(next);
  };
  return {
    products: data?.pages.flatMap((p) => p.entries) ?? null,
    category,
    setCategory,
    failed: error,
    more: hasNextPage ? () => void fetchNextPage() : null,
    loadingMore: isFetchingNextPage,
  };
}

/** Один товар. Пока грузится, показываем карточку из уже загруженного списка. `failed` «Товар не найден» — его нет, он не одобрен или устарел. */
export function useProduct(id: string) {
  const client = useQueryClient();
  const { data, error } = useQuery({
    queryKey: keys.product(id),
    queryFn: () => api.getProduct(id),
    placeholderData: () =>
      client.getQueriesData<InfiniteData<Wire<ProductList>>>({ queryKey: keys.allProducts })
        .flatMap(([, list]) => list?.pages.flatMap((p) => p.entries) ?? [])
        .find((p) => p.id === id),
  });
  return { product: data ?? null, failed: error };
}

// Ответ про вход в раздел запоминаем: при следующем запуске вкладка стоит на месте сразу, а не появляется после ответа сервера.
const TAB_KEY = 'ysw_products_tab';
const remembered = (city: string) => {
  try {
    return localStorage.getItem(TAB_KEY) === city;
  } catch {
    return false;
  }
};
const remember = (city: string, open: boolean) => {
  try {
    if (open) localStorage.setItem(TAB_KEY, city);
    else localStorage.removeItem(TAB_KEY);
  } catch {
    // хранилище закрыто — вкладка просто появится после ответа
  }
};

/**
 * Показывать ли вкладку «Товары»: в городе товары хотя бы у PRODUCTS_MIN_HOSTS мастеров. Спрашиваем одну строку списка —
 * нужен только `hosts_count`. По прямой ссылке раздел открывается и без вкладки.
 */
export function useProductsTab(): boolean {
  const { city_id } = useCity();
  const { data } = useQuery({
    queryKey: keys.productsHosts(city_id),
    queryFn: async () => {
      const { hosts_count } = await api.listProducts({ city_id, pagination_limit: 1 });
      remember(city_id, hosts_count >= PRODUCTS_MIN_HOSTS);
      return hosts_count;
    },
    staleTime: 10 * 60_000,
  });
  return data === undefined ? remembered(city_id) : data >= PRODUCTS_MIN_HOSTS;
}

/** «Написать» мастеру о товаре: его чат в Telegram с готовым текстом и ссылкой на товар. Заказ не храним — нажатие видно только в аналитике. */
export function contactProduct(product: Pick<ProductItem, 'id' | 'title' | 'contact_url' | 'host'>) {
  track('product_contact_clicked', { product_id: product.id, host_id: product.host.id, title: product.title });
  openExternal(product.contact_url);
}
