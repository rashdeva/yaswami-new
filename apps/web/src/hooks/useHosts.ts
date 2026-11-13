import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { HostItem, HostListItem, Practice } from '@yaswami/core';
import { practiceSignupUrl } from '@yaswami/core';
import { track } from '../analytics.ts';
import { api } from '../api.ts';
import { openExternal } from '../tg.ts';
import { keys } from './keys.ts';
import { useSession } from './useSession.ts';

/** Каталог организаторов: у кого есть предстоящие события или регулярные занятия. */
export function useHosts() {
  const { data, error } = useQuery({ queryKey: keys.hosts, queryFn: api.listHosts });
  return { hosts: data ?? null, failed: error };
}

/**
 * Один организатор. Пока грузится страница, показываем то, что уже было в каталоге: без фото и событий
 * (`events` пустой — экран ждёт, а не пишет «событий нет»).
 */
export function useHost(id: string) {
  const client = useQueryClient();
  const { data, error, isPlaceholderData } = useQuery({
    queryKey: keys.host(id),
    queryFn: () => api.getHost(id),
    placeholderData: () => {
      const listed = client.getQueryData<HostListItem[]>(keys.hosts)?.find((h) => h.id === id);
      return listed && ({ ...listed, photos: [], events: [] } satisfies HostItem);
    },
  });
  return { host: data ?? null, loaded: !!data && !isPlaceholderData, failed: error };
}

/**
 * «Записаться» на услугу мастера: намерение записываем в фоне, человека сразу отправляем в чат мастера —
 * иначе браузер сочтёт новую вкладку всплывающим окном.
 * ponytail: без входа запись не сохраняется (нажатие видно только в аналитике); вход перед записью — когда заявки начнут подтверждать.
 */
export function usePracticeSignup() {
  const { authed } = useSession();
  return (host: Pick<HostListItem, 'id' | 'username'>, practice: Pick<Practice, 'id' | 'title'>) => {
    track('practice_signup_clicked', { host_id: host.id, title: practice.title, authed });
    if (authed) api.signUpForPractice(host.id, practice.id).catch(() => {});
    openExternal(practiceSignupUrl(host.username, practice.title));
  };
}
