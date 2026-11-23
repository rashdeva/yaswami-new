// Данные экранов: useQuery на чтение, useMutation на изменение. Экран зовёт хук, api.* видит только этот файл.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CollectedEventItem, Me, RsvpInput } from '@yaswami/core';
import { collectedDayKey, setTopics, TOPIC_GUIDES } from '@yaswami/core';
import { api } from './api';
import { keys } from './keys';

/**
 * Темы в порядке фильтров. Список живёт в базе; до ответа сервера — темы из сборки. Ответ кладётся в реестр ядра
 * (TOPIC_GUIDES): по нему находятся гид, эмодзи и иконка. Экран, который их показывает, зовёт этот хук.
 */
export function useTopics(): string[] {
  useQuery({ queryKey: keys.topics, queryFn: async () => { const topics = await api.topics(); setTopics(topics); return topics; }, staleTime: 5 * 60_000 });
  return Object.keys(TOPIC_GUIDES);
}

/** Витрина, разбитая по дням: список уже отсортирован по началу. */
export function useFeed() {
  const q = useQuery({ queryKey: keys.feed, queryFn: api.collected });
  const days: { key: string; data: CollectedEventItem[] }[] = [];
  for (const item of q.data ?? []) {
    const key = collectedDayKey(item.starts_at);
    if (days.at(-1)?.key === key) days.at(-1)!.data.push(item);
    else days.push({ key, data: [item] });
  }
  return { ...q, days };
}

export function useCollected(id: string) {
  const client = useQueryClient();
  // Карточка из витрины — сразу, пока грузятся организатор и подробности.
  const q = useQuery({
    queryKey: keys.collected(id),
    queryFn: () => api.collectedEvent(id),
    placeholderData: () => client.getQueryData<CollectedEventItem[]>(keys.feed)?.find((e) => e.id === id),
  });
  const signUp = useMutation({
    mutationFn: () => api.signUp(id),
    onSuccess: () => {
      client.setQueryData<Me | null>(keys.me, (m) => m && { ...m, collected_signups: [...new Set([...m.collected_signups, id])] });
      void client.invalidateQueries({ queryKey: keys.mine });
    },
  });
  return { ...q, signUp: signUp.mutate };
}

export function useEvent(id: string) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: keys.event(id), queryFn: () => api.event(id) });
  const rsvp = useMutation({
    mutationFn: (input: RsvpInput) => api.rsvp(id, input),
    onSuccess: (view) => {
      client.setQueryData(keys.event(id), view);
      void client.invalidateQueries({ queryKey: keys.mine });
    },
  });
  return { ...q, rsvp: rsvp.mutateAsync, answering: rsvp.isPending };
}

/** «Мои»: события Ясвами, где человек гость или организатор, и собранные, куда он записывался. */
export function useMine(enabled: boolean) {
  return useQuery({
    queryKey: keys.mine,
    queryFn: async () => {
      const [events, collected] = await Promise.all([api.events(), api.myCollected()]);
      return { events, collected: collected.filter((c) => c.signed_up).map((c) => c.event) };
    },
    enabled,
  });
}

export const useHosts = () => useQuery({ queryKey: keys.hosts, queryFn: api.hosts });
export const useHost = (id: string) => useQuery({ queryKey: keys.host(id), queryFn: () => api.host(id) });
export const useJobs = () => useQuery({ queryKey: keys.jobs, queryFn: api.jobs });
export const useJob = (id: string) => useQuery({ queryKey: keys.job(id), queryFn: () => api.job(id) });

/** Поиск начинается с двух букв — так же проверяет сервер. */
export function useSearch(query: string) {
  const q = query.trim();
  return useQuery({ queryKey: keys.search(q), queryFn: () => api.search(q), enabled: q.length >= 2, placeholderData: (prev) => prev });
}
