// Пользователи сервиса и аудитория организаторов (контакты): поиск, карточка, правки команды.
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminUserView, UserUpdateInput, Wire } from '@yaswami/core';
import { api } from '../api.ts';
import { keys } from './keys.ts';
import { useAct } from './useAct.ts';

/** Поиск по имени или @username; без запроса — первые 50 по имени. */
export const useUsers = (query?: string) =>
  useQuery({ queryKey: keys.users(query || undefined), queryFn: () => api.users(query || undefined), placeholderData: keepPreviousData });

export const useUser = (id: number) => useQuery({ queryKey: keys.user(id), queryFn: () => api.user(id), enabled: Number.isInteger(id) && id > 0 });

/** Имя пользователя по id (кто из команды сделал действие); пока не загрузилось — id. */
export function useUserName(id: number) {
  const { data } = useQuery({ queryKey: keys.user(id), queryFn: () => api.user(id), staleTime: Infinity });
  return data?.user.first_name ?? `id ${id}`;
}

/** Аудитория организатора: кто заходил на его события или отвечал на них. */
export const useContacts = (hostUser: number) => useQuery({ queryKey: keys.contacts(hostUser), queryFn: () => api.contacts(hostUser) });

export function useUserActions(id: number) {
  const client = useQueryClient();
  const undo = () => ['user', String(id)] as ['user', string];
  return {
    update: useAct((input: UserUpdateInput) => api.userUpdate(id, input), {
      undo,
      onSuccess: (user) => client.setQueryData<Wire<AdminUserView>>(keys.user(id), (old) => old && { ...old, user }),
    }),
    remove: useAct(() => api.userDelete(id), { undo }),
    /** Выйти на всех устройствах и отозвать токены агентов: не отменяется. */
    revokeTokens: useAct(() => api.userTokensRevoke(id)),
    removeContact: useAct(api.contactDelete, { undo: (contact) => ['contact', contact] }),
  };
}
