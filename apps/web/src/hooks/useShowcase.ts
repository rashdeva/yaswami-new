import { useQuery } from '@tanstack/react-query';
import { orderShelvesFor } from '@yaswami/core';
import { api } from '../api.ts';
import { keys } from './keys.ts';
import { meQuery, useCity } from './useSession.ts';

/**
 * Витрина города из полок (ADR-0009). Порядок задают команда и куратор; полки тем, на которые человек подписан,
 * поднимаются выше (orderShelvesFor). Не вошёл — порядок как есть.
 */
export function useShowcase() {
  const { city_id } = useCity();
  const subscribed = useQuery(meQuery).data?.subscribed_topics ?? [];
  const { data, error } = useQuery({ queryKey: keys.showcase(city_id), queryFn: () => api.showcase(city_id) });
  return { shelves: data ? orderShelvesFor(data.shelves, subscribed) : null, failed: error };
}

/** Одна полка из уже загруженной витрины: экран полки открывают с витрины, данные там есть. */
export function useShelf(id: string) {
  const { shelves, failed } = useShowcase();
  return { shelf: shelves?.find((s) => s.id === id) ?? null, loading: !shelves && !failed, failed };
}
