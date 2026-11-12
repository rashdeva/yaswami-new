import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { EventCreateInput, EventUpdateInput, RsvpInput } from '@yaswami/core';
import type { EventData } from '../api.ts';
import { api } from '../api.ts';
import { startParam, startRef } from '../tg.ts';
import { keys } from './keys.ts';

/** Сервер вернул новое состояние события: кладём его в кэш и перечитываем «мои события». */
function useEventChanged() {
  const client = useQueryClient();
  return (view: EventData) => {
    client.setQueryData(keys.event(view.event.id), view);
    void client.invalidateQueries({ queryKey: keys.mine });
  };
}

/** Событие Ясвами глазами смотрящего: данные, ответ на приглашение, правка организатором. */
export function useEvent(id: string) {
  const onSuccess = useEventChanged();
  // Ответы других гостей подтягиваем, когда человек возвращается в приложение.
  // Пока иллюстратор рисует обложку, перечитываем событие: картинка появится сама, без перезахода.
  const { data, error, refetch } = useQuery({
    queryKey: keys.event(id), queryFn: () => api.event(id), refetchOnWindowFocus: true,
    refetchInterval: (query) => (query.state.data?.cover_pending ? 5000 : false),
  });
  const rsvp = useMutation({ mutationFn: (input: RsvpInput) => api.rsvp(id, input), onSuccess });
  const update = useMutation({ mutationFn: (input: EventUpdateInput) => api.updateEvent(id, input), onSuccess });
  return { view: data ?? null, failed: error, reload: refetch, rsvp: rsvp.mutateAsync, update: update.mutateAsync };
}

/** Заход фиксируем один раз на открытие; кто позвал — из ссылки, если открыли именно это событие. */
export function useEventVisit(id: string) {
  useEffect(() => { void api.visit(id, id === startParam ? startRef : undefined).catch(() => {}); }, [id]);
}

/** Создание события: новое событие сразу в кэше, список «моих» перечитывается. */
export function useCreateEvent() {
  const onSuccess = useEventChanged();
  return useMutation({ mutationFn: (input: EventCreateInput) => api.createEvent(input), onSuccess }).mutateAsync;
}
