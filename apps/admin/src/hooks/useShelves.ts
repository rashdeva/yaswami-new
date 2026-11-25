// Витрина города (ADR-0009): полки, их правка и перестановка, режим города. Действия отменяются из тоста.
import { useQuery } from '@tanstack/react-query';
import type { ShelfUpdateInput } from '@yaswami/core';
import { api } from '../api.ts';
import { moveShelf } from '../lib/shelves.ts';
import { keys } from './keys.ts';
import { useAct } from './useAct.ts';

const undo = (_input: unknown, shelf: { id: string }) => ['shelf', shelf.id] as ['shelf', string];

export function useShelves(city: string) {
  const shelves = useQuery({ queryKey: keys.shelves(city), queryFn: () => api.shelves(city), refetchInterval: 30_000 });
  const update = useAct(({ id, ...input }: { id: string } & ShelfUpdateInput) => api.shelfUpdate(id, input), { undo });
  // Перестановка — одно действие: правки места идут по очереди, без тоста «Отменить» на каждую (вернуть — стрелкой).
  const move = useAct(async ({ id, step }: { id: string; step: -1 | 1 }) => {
    for (const change of moveShelf(shelves.data ?? [], id, step)) await api.shelfUpdate(change.id, { position: change.position });
  });
  return {
    shelves,
    events: useQuery({ queryKey: keys.cityEvents(city), queryFn: () => api.cityEvents(city) }),
    create: useAct(api.shelfCreate, { undo }),
    update,
    remove: useAct(api.shelfDelete, { undo: (id) => ['shelf', id] }),
    /** Сдвинуть полку выше или ниже: правка `position` у каждой полки, чьё место меняется. */
    move: (id: string, step: -1 | 1) => move({ id, step }),
  };
}
