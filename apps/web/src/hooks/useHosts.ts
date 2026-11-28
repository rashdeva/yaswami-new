import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { HostItem, HostListItem, Practice } from '@yaswami/core';
import { practiceSignupUrl } from '@yaswami/core';
import { track } from '../analytics.ts';
import { api } from '../api.ts';
import { categoryIcon } from '../icons.ts';
import { CHEAP, cheapest, serviceGroups, serviceShortcuts, type ServiceGroup, type ServiceItem } from '../services.ts';
import { openExternal } from '../tg.ts';
import { keys } from './keys.ts';
import { useTopicItems } from './useTopics.ts';
import { useCity, useSession } from './useSession.ts';

/** Каталог организаторов города человека: у кого есть предстоящие события или регулярные занятия. */
export function useHosts() {
  const { city_id } = useCity();
  const { data, error } = useQuery({ queryKey: keys.hosts(city_id), queryFn: () => api.listHosts(city_id) });
  return { hosts: data ?? null, failed: error };
}

/** Сколько услуг на полке «Попробовать недорого» и в её разделе целиком. */
const CHEAP_SHELF = 5;
const CHEAP_ALL = 30;

/**
 * Услуги города для вкладки «Услуги». `sections` — разделы по направлениям; «Детям» в них заменяет одноимённое направление
 * сквозным разделом (те же услуги и ещё размеченные «для детей»). `tiles` — сначала сквозные («Мастер-классы», «Детям»),
 * потом остальные направления. `cheap` — полка «Попробовать недорого». `sections` null — каталог грузится.
 */
export function useServices() {
  const { hosts, failed } = useHosts();
  const topics = useTopicItems();
  if (!hosts) return { sections: null, tiles: [], cheap: [], find: () => undefined, failed };
  const groups = serviceGroups(hosts, topics);
  const items = groups.flatMap((g) => g.items);
  const shortcuts = serviceShortcuts(items, topics);
  const sections = groups.map((g) => shortcuts.find((s) => s.key === g.key) ?? g);
  const tiles = [...shortcuts, ...groups.filter((g) => !shortcuts.some((s) => s.key === g.key))];
  const cheap = cheapest(items, CHEAP_ALL);
  const all: ServiceGroup[] = [...tiles, ...(cheap.length ? [{ key: CHEAP, name: 'Недорого', icon: categoryIcon(CHEAP), tint: 'other', items: cheap }] : [])];
  return { sections, tiles, cheap: cheap.slice(0, CHEAP_SHELF), find: (key: string) => all.find((g) => g.key === key), failed };
}

/** Шторка услуги: какая открыта, переключение на другую услугу того же мастера и запись. */
export function usePracticeSheet() {
  const [open, setOpen] = useState<ServiceItem | null>(null);
  const signUp = usePracticeSignup();
  return {
    open,
    show: (item: ServiceItem) => {
      track('practice_opened', { host_id: item.host.id, title: item.practice.title });
      setOpen(item);
    },
    close: () => setOpen(null),
    pick: (practice: Practice) => setOpen((o) => (o ? { ...o, practice } : o)),
    signUp,
  };
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
      const listed = client.getQueriesData<HostListItem[]>({ queryKey: keys.allHosts }).flatMap(([, list]) => list ?? []).find((h) => h.id === id);
      return listed && ({ ...listed, photos: [], events: [], products: [], feedback_entries: [] } satisfies HostItem);
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
