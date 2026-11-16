import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HostSearchUpdateInput } from '@yaswami/core';
import { track } from '../analytics.ts';
import { api } from '../api.ts';
import { openExternal } from '../tg.ts';
import { keys } from './keys.ts';

/**
 * Запросы организатора и Находки по ним. Первый раз сервер сам предлагает Запросы по его Practice — выключенными.
 * Изменения обновляют список Запросов; удаление — и Находки: вместе с Запросом уходят его.
 */
export function useHostSearches() {
  const client = useQueryClient();
  const searches = useQuery({ queryKey: keys.hostSearches, queryFn: api.listHostSearches });
  const matches = useQuery({ queryKey: keys.hostSearchMatches, queryFn: api.listHostSearchMatches });
  const refresh = () => client.invalidateQueries({ queryKey: keys.hostSearches });

  const create = useMutation({ mutationFn: (query: string) => api.createHostSearch({ query }), onSuccess: () => { track('host_search_created'); return refresh(); } });
  const update = useMutation({
    mutationFn: ({ id, ...input }: HostSearchUpdateInput & { id: string }) => api.updateHostSearch(id, input),
    onSuccess: (_, { status }) => { if (status) track(status === 'active' ? 'host_search_enabled' : 'host_search_paused'); return refresh(); },
  });
  const remove = useMutation({
    mutationFn: api.deleteHostSearch,
    onSuccess: () => Promise.all([refresh(), client.invalidateQueries({ queryKey: keys.hostSearchMatches })]),
  });

  return {
    searches: searches.data?.entries ?? null,
    matches: matches.data?.entries ?? null,
    failed: searches.error ?? matches.error,
    create: create.mutateAsync,
    setActive: (id: string, active: boolean) => update.mutateAsync({ id, status: active ? 'active' : 'paused' }),
    remove: remove.mutateAsync,
  };
}

/** Написать найденному человеку: в личку по username, а без него — к его сообщению в чате. */
export function contactMatch(match: { author_username: string | null; url: string }) {
  track('host_search_match_opened');
  openExternal(match.author_username ? `https://t.me/${match.author_username}` : match.url);
}
