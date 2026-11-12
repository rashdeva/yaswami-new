// Каталог: собранные события любого статуса, одно событие с записавшимися, обложки, правки команды и очередь «По одному».
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
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
    /** Перерисовать обложку и ролик: отменяется, пока очередь не взяла событие. */
    redo: useAct(api.collectedRedo, { undo }),
  };
}

/**
 * Очередь «ждут решения» по одному: решённое и пропущенное сразу уходит с экрана, не дожидаясь перечитывания списка.
 * Не получилось — событие возвращается в очередь (ошибку покажет useAct). Пропущенное вернётся после перезагрузки.
 */
export function useModerationQueue() {
  const items = useCollectedEvents().data;
  const { update } = useCatalogActions();
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const mark = (id: string, on: boolean) => setGone((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const queue = items?.filter((e) => e.status === 'pending' && !gone.has(e.id));
  return {
    current: queue?.[0], left: queue?.length,
    decide: (id: string, input: CollectedUpdateInput) => {
      mark(id, true);
      update({ id, input }, { onError: () => mark(id, false) });
    },
    skip: (id: string) => mark(id, true),
  };
}
