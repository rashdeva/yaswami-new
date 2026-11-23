import { useQuery } from '@tanstack/react-query';
import { DEFAULT_CITY_ID } from '@yaswami/core';
import { api } from '../api.ts';
import { served } from '../served.ts';
import { keys } from './keys.ts';
import { useCity } from './useSession.ts';

/** Витрина: предстоящие события города человека. Список первого города пришёл вместе со страницей — запроса нет. */
export function useCollectedFeed() {
  const { city_id } = useCity();
  const feed = city_id === DEFAULT_CITY_ID ? served.feed : undefined;
  const { data, error } = useQuery({
    queryKey: keys.collected(city_id),
    queryFn: () => api.collected(city_id),
    initialData: feed,
    staleTime: feed ? Infinity : 0,
  });
  return { items: data ?? null, failed: error };
}
