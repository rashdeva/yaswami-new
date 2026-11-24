import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import type { Me } from '@yaswami/core';
import { DEFAULT_CITY_ID, nearestCityId } from '@yaswami/core';
import { identify, track } from '../analytics.ts';
import { api, hasCredentials } from '../api.ts';
import { setLinkConfig } from '../format.ts';
import { currentPosition } from '../tg.ts';
import { served } from '../served.ts';
import { keys } from './keys.ts';

/**
 * Общие запросы приложения (кто я, настройки, города) читают многие компоненты, и они появляются и исчезают вместе со
 * экранами. Без `retryOnMount: false` упавший запрос повторялся бы при монтировании каждого нового читателя, а повтор без
 * данных возвращает `me` в undefined: витрина меняется на спиннер и обратно, и так по кругу, пока API лежит.
 * Повторяет их перезагрузка страницы («Попробовать ещё раз»).
 */
const shared = { staleTime: Infinity, retryOnMount: false } as const;

/** Запрос «кто я» — один на всех: useSession, useCity, useTopicSubscription. Не получилось узнать, кто это, — считаем, что не вошёл. */
export const meQuery = { queryKey: keys.me, queryFn: (): Promise<Me | null> => api.me(), ...shared };

/** Кто вошёл и настройки сервера. `me`: undefined — ещё выясняем, null — не вошёл. */
export function useSession() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const config = useQuery({ queryKey: keys.config, queryFn: () => api.config().then((c) => (setLinkConfig(c), c)), ...shared }).data;
  const { data, isPending } = useQuery(meQuery);
  const city = useCity().name;
  const me = isPending ? undefined : data ?? null;
  // Аналитика узнаёт, чьи это действия; после выхода — снова аноним.
  const known = me !== undefined;
  const { id, first_name, username } = me?.user ?? {};
  const features = me?.features.join(',') ?? '';
  useEffect(() => {
    if (known) identify(id && first_name ? { id, first_name, username: username ?? null, features: features ? features.split(',') : [] } : null);
  }, [known, id, first_name, username, features]);

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
      // Подтвердивший становится организатором: сервер открыл ему создание событий.
      client.setQueryData<Me | null>(keys.me, (m) => m && { ...m, features: [...new Set([...m.features, 'event_create' as const])], claimable: m.claimable.filter((c) => c.id !== id) });
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
    /** Возможности, открытые человеку; экраны спрашивают через `useFeature`. */
    features: me?.features ?? [],
    city,
    // Войти на сайте можно, когда сервер это умеет, а человек открыл страницу не из Telegram.
    canLogin: !!config?.web_login && !hasCredentials,
    claim: claim.mutateAsync,
    logout: logout.mutateAsync,
  };
}

// Город гостя без входа — в браузере: важен только ему и только здесь. У вошедшего город в `me`, он же копируется сюда,
// чтобы после перезапуска витрина его города открывалась, не дожидаясь `me`.
const CITY_KEY = 'city_id';
const storedCity = (): string | null => {
  try {
    return localStorage.getItem(CITY_KEY);
  } catch {
    return null;
  }
};
const storeCity = (id: string) => {
  try {
    localStorage.setItem(CITY_KEY, id);
  } catch { /* приватное окно: выбор живёт до перезагрузки */ }
};

/**
 * Город человека: его витрину, «Услуги», вакансии и поиск показывает приложение. `cities` — из чего выбрать; `set` —
 * сменить: вошедшему пишем на сервер (по нему же идёт сводка по темам), гостю — в браузер. `chosen`: false — ещё не
 * выбирал (витрина спросит), undefined — выясняем, кто это; до выбора всё идёт по первому городу.
 */
export function useCity() {
  const client = useQueryClient();
  // Города приходят вместе со страницей (served.cities): название города есть сразу.
  const cities = useQuery({ queryKey: keys.cities, queryFn: api.cities, initialData: served.cities, ...shared }).data ?? [];
  const { data: me, isPending } = useQuery(meQuery);
  const guest = useQuery({ queryKey: keys.guestCity, queryFn: storedCity, staleTime: Infinity }).data;
  // Сохранённого города больше нет (команда его убрала) — спрашиваем заново, а не показываем пустую витрину.
  const known = (id: string | null | undefined) => id && (!cities.length || cities.some((c) => c.id === id)) ? id : null;
  const picked = known(me?.city_id) ?? known(guest);
  const city_id = picked ?? DEFAULT_CITY_ID;
  const chosen = picked ? true : isPending ? undefined : false;
  useEffect(() => { if (me?.city_id) storeCity(me.city_id); }, [me?.city_id]);
  const set = useMutation({
    mutationFn: async (id: string) => {
      storeCity(id);
      client.setQueryData(keys.guestCity, id);
      if (!me) return;
      client.setQueryData<Me | null>(keys.me, (m) => m && { ...m, city_id: id });
      client.setQueryData(keys.me, await api.updateSelf({ city_id: id }));
    },
    onSuccess: (_, id) => track('city_changed', { city_id: id }),
    // Сервер не принял — возвращаем то, что на нём на самом деле.
    onError: () => {
      if (me?.city_id) storeCity(me.city_id);
      client.setQueryData(keys.guestCity, me?.city_id ?? storedCity());
      void client.invalidateQueries({ queryKey: keys.me });
    },
  });
  // Выбрал город гостем, потом вошёл, а на сервере города ещё нет — переносим выбор, чтобы не спрашивать второй раз.
  const carry = me && !me.city_id ? known(guest) : null;
  const { mutate } = set;
  useEffect(() => { if (carry) mutate(carry); }, [carry, mutate]);
  /** Город по геолокации: ближайший из наших; null — рядом наших нет или человек не разрешил. */
  const locate = async () => {
    const at = await currentPosition();
    return at && nearestCityId(cities, at);
  };
  const name = (id: string) => cities.find((c) => c.id === id)?.name ?? '';
  return { city_id, name: name(city_id), nameOf: name, chosen, cities, set: set.mutate, locate };
}
