// Организаторы собранных событий: список, профиль и правки команды.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminHostView, HostUpdateInput, Wire } from '@yaswami/core';
import { api } from '../api.ts';
import { keys } from './keys.ts';
import { useAct } from './useAct.ts';

export const useHosts = () => useQuery({ queryKey: keys.hosts, queryFn: api.hosts });
export const useHost = (id: string) => useQuery({ queryKey: keys.host(id), queryFn: () => api.host(id) });

/** Добавить организатора по username: профиль заполнит сборщик на следующем проходе. */
export const useHostCreate = () => useAct(api.hostCreate, { undo: (_username, host) => ['host', host.id] });

export function useHostActions(id: string) {
  const client = useQueryClient();
  const undo = () => ['host', id] as ['host', string];
  return {
    update: useAct((input: HostUpdateInput) => api.hostUpdate(id, input), {
      undo,
      onSuccess: (host) => {
        client.setQueryData<Wire<AdminHostView>>(keys.host(id), (old) => old && { ...old, ...host });
        void client.invalidateQueries({ queryKey: keys.hosts }); // статус меняет очередь «Ждут решения» в списке
      },
    }),
    remove: useAct(() => api.hostDelete(id), { undo }),
  };
}
