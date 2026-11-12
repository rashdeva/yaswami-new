import { useQuery } from '@tanstack/react-query';
import { api } from '../api.ts';
import { served } from '../served.ts';
import { keys } from './keys.ts';

/** Витрина: предстоящие события города. Список пришёл вместе со страницей — запроса нет. */
export function useCollectedFeed() {
  const { data, error } = useQuery({
    queryKey: keys.collected,
    queryFn: api.collected,
    initialData: served.feed,
    staleTime: served.feed ? Infinity : 0,
  });
  return { items: data ?? null, failed: error };
}
