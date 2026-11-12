// Модерация собранных событий: список любого статуса, правка и решения по событию, очередь «по одному».
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { CollectedUpdateInput } from '@yaswami/core';
import { api } from '../api.ts';
import { keys } from './keys.ts';
import { useAct } from './useAct.ts';

const POLL_MS = 30_000; // события появляются раз в проход сборщика, чаще опрашивать незачем

export const useCollectedEvents = () => useQuery({ queryKey: keys.collectedEvents, queryFn: api.adminEvents, refetchInterval: POLL_MS }).data;

type Update = { id: string; input: CollectedUpdateInput };

export function useModeration() {
  return {
    update: useAct(({ id, input }: Update) => api.adminEventUpdate(id, input)),
    remove: useAct(api.adminEventDelete),
  };
}

/**
 * Очередь «ждут решения» по одному: решённое и пропущенное сразу уходит с экрана, не дожидаясь перечитывания списка.
 * Не получилось — событие возвращается в очередь (ошибку покажет useAct). Пропущенное вернётся после перезагрузки.
 */
export function useModerationQueue() {
  const items = useCollectedEvents();
  const { update } = useModeration();
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
