// Города: список, добавить, переименовать, сменить часовой пояс, отправить в архив и вернуть. Действия отменяются из тоста.
import { useQuery } from '@tanstack/react-query';
import type { CityUpdateInput } from '@yaswami/core';
import { DEFAULT_CITY_ID } from '@yaswami/core';
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

/**
 * Город по умолчанию этой копии (DEFAULT_CITY_ID у сервера): его витрина открывается первой, новое без города попадает
 * в него, и в архив он не уходит. Пока настройки не пришли — запасной из core.
 */
export function useDefaultCity(): string {
  return useQuery({ queryKey: keys.config, queryFn: api.config, staleTime: Infinity }).data?.default_city_id ?? DEFAULT_CITY_ID;
}
