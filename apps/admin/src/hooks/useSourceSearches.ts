// Поиск источников города: последние поиски, «Найти сейчас» и добавить найденное в источники. Пока поиск ждёт
// сборщика или идёт, список перечитывается сам.
import { useQuery } from '@tanstack/react-query';
import { api } from '../api.ts';
import { keys } from './keys.ts';
import { useAct } from './useAct.ts';

const BUSY = new Set(['queued', 'running']);

export function useSourceSearches(city: string) {
  const searches = useQuery({
    queryKey: keys.sourceSearches(city),
    queryFn: () => api.sourceSearches(city),
    refetchInterval: (q) => (BUSY.has(q.state.data?.[0]?.status ?? '') ? 15_000 : false),
  });
  const latest = searches.data?.[0];
  return {
    searches,
    /** Последний поиск: с ним работает экран; `busy` — ждёт сборщика или идёт. */
    latest,
    busy: BUSY.has(latest?.status ?? ''),
    /** Последний завершённый: его итог показываем, пока новый ещё ищется. */
    lastDone: searches.data?.find((s) => s.status === 'done'),
    request: useAct(() => api.sourceSearchCreate({ city_id: city })),
    add: useAct(api.sourceCreate, { undo: (_input, source) => ['source', source.channel] }),
  };
}
