import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HostSelfUpdateInput } from '@yaswami/core';
import { track } from '../analytics.ts';
import { api } from '../api.ts';
import { keys } from './keys.ts';

/**
 * Свой профиль организатора: ссылка «оставьте отзыв» для клиентов (открывает бота) и что обещано за отзыв. `enabled` — человек
 * открыл собственную страницу; остальным сервер ответил бы отказом.
 */
export function useHostSelf(enabled: boolean) {
  const client = useQueryClient();
  const { data } = useQuery({ queryKey: keys.hostSelf, queryFn: () => api.getHostSelf(), enabled });
  const update = useMutation({
    mutationFn: (input: HostSelfUpdateInput) => api.updateHostSelf(input),
    onSuccess: (saved) => {
      track('host_bonus_saved', { host_id: saved.host_id, set: saved.feedback_bonus !== null });
      client.setQueryData(keys.hostSelf, saved);
      void client.invalidateQueries({ queryKey: keys.host(saved.host_id) });
    },
  });
  return { self: data ?? null, save: update.mutate, saving: update.isPending, saved: update.isSuccess, failed: update.error };
}
