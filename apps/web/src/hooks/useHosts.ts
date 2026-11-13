import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { HostItem, HostListItem } from '@yaswami/core';
import { api } from '../api.ts';
import { keys } from './keys.ts';

/** Каталог организаторов: у кого есть предстоящие события или регулярные занятия. */
export function useHosts() {
  const { data, error } = useQuery({ queryKey: keys.hosts, queryFn: api.listHosts });
  return { hosts: data ?? null, failed: error };
}

/**
 * Один организатор. Пока грузится страница, показываем то, что уже было в каталоге: без фото и событий
 * (`events` пустой — экран ждёт, а не пишет «событий нет»).
 */
export function useHost(id: string) {
  const client = useQueryClient();
  const { data, error, isPlaceholderData } = useQuery({
    queryKey: keys.host(id),
    queryFn: () => api.getHost(id),
    placeholderData: () => {
      const listed = client.getQueryData<HostListItem[]>(keys.hosts)?.find((h) => h.id === id);
      return listed && ({ ...listed, photos: [], events: [] } satisfies HostItem);
    },
  });
  return { host: data ?? null, loaded: !!data && !isPlaceholderData, failed: error };
}
