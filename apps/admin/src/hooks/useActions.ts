// Журнал действий команды: лента с подгрузкой, одно действие со снимками, история одной сущности.
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { AdminActionListInput, AdminEntity } from '@yaswami/core';
import { api } from '../api.ts';
import { keys } from './keys.ts';

export type ActionFilter = Omit<AdminActionListInput, 'pagination_cursor' | 'pagination_limit'>;

/** Лента журнала, новые сверху; следующая страница — по `next_cursor`. */
export function useActionFeed(filter: ActionFilter) {
  const q = useInfiniteQuery({
    queryKey: keys.actions(filter),
    queryFn: ({ pageParam }) => api.actions({ ...filter, pagination_cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  });
  return { ...q, entries: q.data?.pages.flatMap((p) => p.entries) };
}

export const useAction = (id: string) => useQuery({ queryKey: keys.action(id), queryFn: () => api.action(id) });

/** Последние действия над одной сущностью — блок «История» в её карточке. */
export function useHistory(entity: AdminEntity, entity_id: string, limit = 10) {
  const filter = { entity, entity_id, pagination_limit: limit };
  return useQuery({ queryKey: keys.actions(filter), queryFn: () => api.actions(filter) });
}
