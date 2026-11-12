// Модерация собранных событий: список любого статуса и решения по событию.
import { useQuery } from '@tanstack/react-query';
import type { CollectedModerateInput } from '@yaswami/core';
import { api } from '../api.ts';
import { keys } from './keys.ts';
import { useAct } from './useAct.ts';

const POLL_MS = 30_000; // события появляются раз в проход сборщика, чаще опрашивать незачем

export const useCollectedEvents = () => useQuery({ queryKey: keys.collectedEvents, queryFn: api.adminEvents, refetchInterval: POLL_MS }).data;

export function useModeration() {
  return {
    moderate: useAct(({ id, status }: { id: string; status: CollectedModerateInput['status'] }) => api.adminEventModerate(id, status)),
    remove: useAct(api.adminEventDelete),
    redo: useAct(api.adminEventRedo),
  };
}
