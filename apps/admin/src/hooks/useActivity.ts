// «Активность»: кто пришёл, куда записался, что открывал — лента, новые сверху, страницами по `next_cursor`.
import { useInfiniteQuery } from '@tanstack/react-query';
import type { AdminActivityListInput } from '@yaswami/core';
import { api } from '../api.ts';
import { keys } from './keys.ts';

export type ActivityQuery = Omit<AdminActivityListInput, 'pagination_cursor'>;

/** Лента; раз в 30 с перечитывается первая страница — новые строки появляются сами. */
export function useActivity(filter: ActivityQuery) {
  const q = useInfiniteQuery({
    queryKey: keys.activity(filter),
    queryFn: ({ pageParam }) => api.activity({ ...filter, pagination_cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    refetchInterval: 30_000,
  });
  return { ...q, entries: q.data?.pages.flatMap((p) => p.entries) };
}
