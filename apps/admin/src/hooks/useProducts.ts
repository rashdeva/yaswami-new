// Товары «Каталога»: список по статусу с подгрузкой, счётчики вкладок и правки команды (решение модератора или поля).
import { useInfiniteQuery } from '@tanstack/react-query';
import type { AdminProductListInput, ProductStatus, ProductUpdateInput } from '@yaswami/core';
import { PRODUCT_STATUSES } from '@yaswami/core';
import type { ApiError } from '../api.ts';
import { api } from '../api.ts';
import { countLabel } from '../lib/catalog.ts';
import { keys } from './keys.ts';
import { useAct } from './useAct.ts';
import { POLL_MS } from './useCollectedEvents.ts';

export type ProductFilter = Pick<AdminProductListInput, 'status'>;

/** Страница побольше: поиск и счётчики вкладок считают по загруженному. */
const PAGE = 100;

/** Товары, свежие сверху; следующая страница — по `next_cursor`. `poll` — перечитывать раз в столько мс. */
export function useProducts(filter: ProductFilter, poll: number = POLL_MS) {
  const q = useInfiniteQuery({
    queryKey: keys.products(filter),
    queryFn: ({ pageParam }) => api.products({ ...filter, pagination_limit: PAGE, pagination_cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    refetchInterval: poll,
  });
  return {
    ...q,
    entries: q.data?.pages.flatMap((p) => p.entries),
    more: { more: !!q.hasNextPage, loading: q.isFetchingNextPage, onMore: () => void q.fetchNextPage() },
  };
}

/**
 * Счётчики вкладок по статусам: те же запросы, что у вкладок (кэш общий). Отдельного счёта в API нет — считаем
 * загруженное; есть ещё страницы — «100+». `null` — ещё грузится.
 */
export function useProductCounts(): Record<'all' | ProductStatus, string> | null {
  const lists = [useProducts({ status: 'pending' }), useProducts({ status: 'published' }), useProducts({ status: 'rejected' })]; // порядок PRODUCT_STATUSES
  if (lists.some((l) => !l.entries)) return null;
  const counts = Object.fromEntries(PRODUCT_STATUSES.map((s, i) => [s, countLabel(lists[i]!.entries!.length, !!lists[i]!.hasNextPage)]));
  const total = lists.reduce((n, l) => n + l.entries!.length, 0);
  return { ...counts, all: countLabel(total, lists.some((l) => l.hasNextPage)) } as Record<'all' | ProductStatus, string>;
}

/** Решение по товару (`status`) или правка его полей — одно действие `admin_products_update`, отменяется из тоста и журнала. */
export const useProductUpdate = () =>
  useAct(({ id, input }: { id: string; input: ProductUpdateInput }) => api.productUpdate(id, input), { undo: ({ id }) => ['product', id] });

/** Новое название уже есть у этого мастера (409 `product_exists`): форма ставит ошибку у поля «Название». */
export const titleTaken = (e: Error) => (e as ApiError).code === 'product_exists';
