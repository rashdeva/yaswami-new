import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { SearchInput } from '@yaswami/core';
import { api } from '../api.ts';
import { keys } from './keys.ts';
import { useCity } from './useSession.ts';

/**
 * Единый поиск по каталогу города человека: события и Practice. Запрос уходит, когда человек перестал печатать;
 * пока идёт новый — на экране прежние находки. `entries` null — искать ещё нечего (запрос короткий) или первый ответ в пути.
 */
export function useSearch(typed: string) {
  const [settled, setSettled] = useState(typed);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(typed), 250);
    return () => clearTimeout(timer);
  }, [typed]);
  const query = settled.trim();
  const ready = SearchInput.shape.query.safeParse(query).success;
  const { city_id } = useCity();
  const { data, error } = useQuery({
    queryKey: keys.search(query, city_id),
    queryFn: () => api.search(query, city_id),
    enabled: ready,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  return { ready, entries: ready ? data?.entries ?? null : null, failed: ready ? error : null };
}
