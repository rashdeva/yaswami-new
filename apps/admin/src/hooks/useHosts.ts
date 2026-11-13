// Организаторы собранных событий: список, профиль и правки команды.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminHostView, HostUpdateInput, PracticeStatus, Wire } from '@yaswami/core';
import { api } from '../api.ts';
import { keys } from './keys.ts';
import { useAct } from './useAct.ts';

export const useHosts = () => useQuery({ queryKey: keys.hosts, queryFn: api.hosts });
export const useHost = (id: string) => useQuery({ queryKey: keys.host(id), queryFn: () => api.host(id) });

/** Добавить организатора по username: профиль заполнит сборщик на следующем проходе. */
export const useHostCreate = () => useAct(api.hostCreate, { undo: (_input, host) => ['host', host.id] });

/** Решение по одной услуге из «Каталога»: меняется только она — два решения подряд по услугам одного мастера не мешают друг другу. */
export const usePracticeStatus = () =>
  useAct(({ practice_id, status }: { host_id: string; practice_id: string; status: PracticeStatus }) => api.practiceUpdate(practice_id, { status }), { undo: ({ host_id }) => ['host', host_id] });

export function useHostActions(id: string) {
  const client = useQueryClient();
  const undo = () => ['host', id] as ['host', string];
  return {
    update: useAct((input: HostUpdateInput) => api.hostUpdate(id, input), {
      undo,
      onSuccess: (host) => {
        client.setQueryData<Wire<AdminHostView>>(keys.host(id), (old) => old && { ...old, ...host });
        void client.invalidateQueries({ queryKey: keys.hosts });
      },
    }),
    remove: useAct(() => api.hostDelete(id), { undo }),
  };
}
