import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import type { CollectedEventItem, Me } from '@yaswami/core';
import { track } from '../analytics.ts';
import { api } from '../api.ts';
import { served } from '../served.ts';
import { keys } from './keys.ts';
import { useViewed } from './useViewed.ts';
import type { MyEvents } from './useMyEvents.ts';

/** Собранное событие: карточка, отметка о заходе и запись («Записаться»). `authed` — человек вошёл: заход и запись можно зафиксировать. */
export function useCollectedEvent(id: string, authed: boolean, toast: (text: string) => void) {
  const client = useQueryClient();
  const navigate = useNavigate();
  // Карточку показываем сразу — со страницы или из списка, откуда пришли, — но запрашиваем всё равно:
  // профиль организатора есть только в ответе на одно событие.
  const { data, error } = useQuery({
    queryKey: keys.collectedEvent(id),
    queryFn: () => api.collectedEvent(id),
    initialData: () =>
      (served.event?.id === id ? served.event : undefined)
      ?? client.getQueryData<CollectedEventItem[]>(keys.collected)?.find((e) => e.id === id)
      ?? client.getQueryData<MyEvents>(keys.mine)?.seen.find((c) => c.event.id === id)?.event,
  });

  // Заход вошедшего человека: по ним организатор потом увидит свою аудиторию. Анонимных не считаем.
  useEffect(() => { if (authed) void api.visitCollected(id).catch(() => {}); }, [id, authed]);
  useViewed('collected_event_viewed', id);

  const signUp = useMutation({
    mutationFn: () => api.signUp(id),
    onSuccess: () => {
      track('collected_signed_up', { collected_event_id: id });
      client.setQueryData<Me | null>(keys.me, (m) => (m && !m.collected_signups.includes(id) ? { ...m, collected_signups: [...m.collected_signups, id] } : m));
      void client.invalidateQueries({ queryKey: keys.collectedEvent(id) });
      void client.invalidateQueries({ queryKey: keys.mine });
    },
  });

  // Вернулись после входа, начатого кнопкой «Записаться»: фиксируем запись, к организатору человек перейдёт
  // вторым нажатием — открыть новую вкладку без нажатия браузер не даст.
  const resumed = useRef(false);
  const { mutate } = signUp;
  useEffect(() => {
    if (resumed.current || !authed || !new URLSearchParams(location.search).has('signup')) return;
    resumed.current = true;
    void navigate({ to: '/e/$id', params: { id }, replace: true }); // убираем ?signup из адреса
    mutate(undefined, {
      onSuccess: () => toast('Вы записаны. Напишите организатору, чтобы подтвердить место'),
      onError: (e) => toast(e.message),
    });
  }, [authed, id, mutate, navigate, toast]);

  /** `signUp` — запись в фоне: о сбое молчим, человек в это время уже уходит к организатору. */
  return { event: data ?? null, failed: error, signUp: () => mutate() };
}
