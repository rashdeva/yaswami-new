// Каталог: собранные события любого статуса, одно событие с записавшимися, обложки и правки команды.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminCollectedEventView, CollectedUpdateInput, Wire } from '@yaswami/core';
import { api } from '../api.ts';
import { keys } from './keys.ts';
import { useAct } from './useAct.ts';

const POLL_MS = 30_000; // события появляются раз в проход сборщика, чаще опрашивать незачем

/** Все собранные события (без статуса): нужен и счётчик в меню, и отбор в каталоге. */
export const useCollectedEvents = () => useQuery({ queryKey: keys.collectedEvents(), queryFn: () => api.collectedEvents(), refetchInterval: POLL_MS });
export const useCollectedEvent = (id: string) => useQuery({ queryKey: keys.collectedEvent(id), queryFn: () => api.collectedEvent(id) });
/** Ждут решения иллюстратора об обложке. */
export const useCovers = () => useQuery({ queryKey: keys.covers, queryFn: api.covers });

export function useCatalogActions() {
  const client = useQueryClient();
  const undo = (input: { id: string } | string) => ['collected_event', typeof input === 'string' ? input : input.id] as ['collected_event', string];
  return {
    /** Поля анонса и/или решение модератора (`status`). */
    update: useAct(({ id, input }: { id: string; input: CollectedUpdateInput }) => api.collectedUpdate(id, input), {
      undo,
      onSuccess: (item, { id }) => client.setQueryData<Wire<AdminCollectedEventView>>(keys.collectedEvent(id), (old) => old && { ...old, ...item }),
    }),
    remove: useAct(api.collectedDelete, { undo }),
    /** Без `image_url` — оставить фото анонса обложкой. */
    setCover: useAct(({ id, image_url }: { id: string; image_url?: string }) => api.coverSet(id, image_url), { undo }),
    /** Заказ ролика стоит денег и не отменяется. */
    requestVideo: useAct(api.videoRequest),
  };
}
