import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import type { Me } from '@yaswami/core';
import { identify, track } from '../analytics.ts';
import { api, hasCredentials } from '../api.ts';
import { setLinkConfig } from '../format.ts';
import { keys } from './keys.ts';

/** Кто вошёл и настройки сервера. `me`: undefined — ещё выясняем, null — не вошёл. */
export function useSession() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const config = useQuery({ queryKey: keys.config, queryFn: () => api.config().then((c) => (setLinkConfig(c), c)), staleTime: Infinity }).data;
  // Не получилось узнать, кто это, — считаем, что не вошёл.
  const { data, isPending } = useQuery({ queryKey: keys.me, queryFn: (): Promise<Me | null> => api.me(), staleTime: Infinity });
  const me = isPending ? undefined : data ?? null;
  // Аналитика узнаёт, чьи это действия; после выхода — снова аноним.
  const known = me !== undefined;
  const { id, first_name, username } = me?.user ?? {};
  useEffect(() => { if (known) identify(id && first_name ? { id, first_name, username: username ?? null } : null); }, [known, id, first_name, username]);

  // Организатор подтверждает собранное событие: оно становится его событием Ясвами и открывается сразу.
  // Сначала переход, потом правка `me`: иначе страница, с которой уходим, успеет перерисоваться без кнопки.
  const claim = useMutation({
    mutationFn: async (id: string) => {
      const view = await api.claim(id);
      client.setQueryData(keys.event(view.event.id), view);
      await navigate({ to: '/events/$id', params: { id: view.event.id } });
    },
    onSuccess: (_, id) => {
      track('event_claimed', { collected_event_id: id });
      client.setQueryData<Me | null>(keys.me, (m) => m && { ...m, claimable: m.claimable.filter((c) => c.id !== id) });
      void client.invalidateQueries({ queryKey: keys.mine });
      void client.invalidateQueries({ queryKey: keys.collectedEvent(id) });
    },
  });
  const logout = useMutation({
    // Выход ведёт на витрину; сначала переход, чтобы личная страница не мигнула приглашением войти.
    mutationFn: async () => {
      await api.logout();
      await navigate({ to: '/' });
    },
    onSuccess: () => {
      track('logged_out');
      client.setQueryData(keys.me, null);
      client.removeQueries({ queryKey: keys.mine });
    },
  });

  return {
    me,
    authed: !!me,
    city: config?.city ?? 'Дананг',
    // Войти на сайте можно, когда сервер это умеет, а человек открыл страницу не из Telegram.
    canLogin: !!config?.web_login && !hasCredentials,
    claim: claim.mutateAsync,
    logout: logout.mutateAsync,
  };
}
