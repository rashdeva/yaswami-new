import { useQuery } from '@tanstack/react-query';
import type { MyCollectedItem } from '@yaswami/core';
import type { EventListData } from '../api.ts';
import { api } from '../api.ts';
import { keys } from './keys.ts';
import { useSession } from './useSession.ts';

/** Что лежит в кэше под `keys.mine`. `seen` — собранные события, куда человек заходил. */
export interface MyEvents { events: EventListData[]; seen: MyCollectedItem[] }

/** «Мои события»: свои и собранные, на которые человек записался. Читаются, когда человек вошёл; каждый экран, открываясь, перечитывает. */
export function useMyEvents() {
  const { authed } = useSession();
  const { data, error } = useQuery({
    queryKey: keys.mine,
    enabled: authed,
    // Собранные события — «куда заходил»: их сбой не должен ронять список своих.
    queryFn: async (): Promise<MyEvents> => {
      const [events, seen] = await Promise.all([api.events(), api.myCollected().catch(() => [])]);
      return { events, seen };
    },
  });
  const collected = data?.seen.filter((c) => c.signed_up) ?? []; // просто заходили — не показываем
  return {
    events: data?.events ?? null,
    collected,
    /** Сколько всего событий, включая те, куда только заходил; null — ещё не знаем. */
    total: data ? data.events.length + data.seen.length : null,
    hasEvents: !!data?.events.length || collected.length > 0,
    failed: data ? null : error,
  };
}
