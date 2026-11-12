import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../api.ts';
import { keys } from './keys.ts';
import { useInbox } from './useInbox.ts';

/** Сводка для «Организаторов» и «Агентов»: перечитывается, когда в ленте появилось новое сообщение. */
export function useOverview() {
  const newest = useInbox().feed?.messages[0]?.id;
  return useQuery({ queryKey: keys.overview(newest), queryFn: api.overview, placeholderData: keepPreviousData }).data;
}
