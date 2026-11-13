// Города: список, добавить, переименовать или сменить часовой пояс. Действия отменяются из тоста.
import { useQuery } from '@tanstack/react-query';
import type { CityUpdateInput } from '@yaswami/core';
import { api } from '../api.ts';
import { keys } from './keys.ts';
import { useAct } from './useAct.ts';

const undo = (_input: unknown, city: { id: string }) => ['city', city.id] as ['city', string];

export function useCities() {
  return {
    cities: useQuery({ queryKey: keys.cities, queryFn: api.cities }),
    create: useAct(api.cityCreate, { undo }),
    update: useAct(({ id, ...input }: { id: string } & CityUpdateInput) => api.cityUpdate(id, input), { undo }),
  };
}
