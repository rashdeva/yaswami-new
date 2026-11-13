// События Ясвами: список, событие, гости, отзывы и все правки команды над ними.
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminEventUpdateInput, AdminEventView, AdminGuestUpdateInput, TicketTypeCreateInput, TicketTypeUpdateInput, Wire } from '@yaswami/core';
import { api } from '../api.ts';
import { keys } from './keys.ts';
import { useAct } from './useAct.ts';

export type EventsWhen = 'upcoming' | 'past' | 'all';

/** Список событий: предстоящие, прошедшие или все; `query` — часть названия. */
export function useEventList(filter: { when: EventsWhen; query?: string }) {
  return useQuery({
    queryKey: keys.events(filter),
    queryFn: () => {
      const now = new Date().toISOString();
      return api.events({ after: filter.when === 'upcoming' ? now : undefined, before: filter.when === 'past' ? now : undefined, query: filter.query || undefined });
    },
    placeholderData: keepPreviousData,
  });
}

export const useEvent = (id: string) => useQuery({ queryKey: keys.event(id), queryFn: () => api.event(id) });
export const useGuests = (id: string) => useQuery({ queryKey: keys.guests(id), queryFn: () => api.guests(id) });
export const useFeedback = (id: string) => useQuery({ queryKey: keys.feedback(id), queryFn: () => api.feedback(id) });

export const useCreateEvent = () => useAct(api.eventCreate, { undo: (_, r) => ['event', r.event.id] });

/** Правки события `id`; все отменяемые — тост «Отменить» ищет строку журнала по событию. */
export function useEventActions(id: string) {
  const client = useQueryClient();
  const undo = () => ['event', id] as ['event', string];
  return {
    update: useAct((input: AdminEventUpdateInput) => api.eventUpdate(id, input), {
      undo,
      onSuccess: (view) => client.setQueryData<Wire<AdminEventView>>(keys.event(id), (old) => old && { ...old, ...view }),
    }),
    remove: useAct(() => api.eventDelete(id), { undo }),
    setGuest: useAct(({ user_id, ...input }: AdminGuestUpdateInput & { user_id: number }) => api.guestUpdate(id, user_id, input), { undo }),
    removeGuest: useAct((user: number) => api.guestRemove(id, user), { undo }),
    createTicketType: useAct((input: TicketTypeCreateInput) => api.ticketTypeCreate(id, input), { undo }),
    updateTicketType: useAct(({ ticket, input }: { ticket: string; input: TicketTypeUpdateInput }) => api.ticketTypeUpdate(ticket, input), { undo }),
    removeTicketType: useAct(api.ticketTypeDelete, { undo }),
    removeFeedback: useAct((user: number) => api.feedbackDelete(id, user), { undo }),
  };
}
