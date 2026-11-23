import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Me } from '@yaswami/core';
import { track } from '../analytics.ts';
import { api } from '../api.ts';
import { tg } from '../tg.ts';
import { keys } from './keys.ts';

/**
 * Подписка на темы: о новых событиях этих Topic человеку раз в день пишет бот.
 * `topics`: undefined — не вошёл или ещё выясняем, null — ещё не спрашивали, [] — отказался.
 */
export function useTopicSubscription() {
  const client = useQueryClient();
  // Тот же запрос, что в useSession: здесь только читаем его кэш.
  const me = useQuery({ queryKey: keys.me, queryFn: (): Promise<Me | null> => api.me(), staleTime: Infinity }).data;
  const save = useMutation({
    mutationFn: (topics: string[]) => api.updateSelf({ subscribed_topics: topics }),
    onSuccess: (next, topics) => {
      client.setQueryData(keys.me, next);
      if (topics.length) {
        track('topics_subscribed', { topics: topics.join(','), count: topics.length });
        tg?.requestWriteAccess?.();
      } else track('topics_skipped');
    },
  });
  return { topics: me ? me.subscribed_topics : undefined, save: save.mutateAsync, saving: save.isPending, failed: save.error };
}
