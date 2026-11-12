// Переписка в реальном времени (`GET /admin/live`): кто сейчас пишет и сигнал «в переписке новое» — по нему лента
// и открытая переписка перечитываются сразу, не дожидаясь опроса. Опрос остаётся запасным путём.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { Typing } from '@yaswami/core';
import { api } from '../api.ts';
import { keys } from './keys.ts';

const RETRY_MS = 3000;

/** Держит поток открытым, пока `on`; оборвался — переподключается. Зовётся один раз, в App. */
export function useLive(on: boolean) {
  const client = useQueryClient();
  useEffect(() => {
    if (!on) return;
    const stop = new AbortController();
    void (async () => {
      while (!stop.signal.aborted) {
        await api.live((e) => {
          if (e.event === 'typing') client.setQueryData(keys.live, JSON.parse(e.data) as Typing[]);
          if (e.event === 'changed') {
            void client.invalidateQueries({ queryKey: keys.inbox });
            void client.invalidateQueries({ queryKey: ['thread'] });
          }
        }, stop.signal).catch(() => {});
        client.setQueryData(keys.live, []); // связи нет — кто пишет, неизвестно
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
      }
    })();
    return () => stop.abort();
  }, [on, client]);
}

/**
 * Кто сейчас пишет во всех диалогах. Данные кладёт только поток (`useLive`): запрос выключен, поэтому общее
 * «перечитать всё» после действия их не стирает.
 */
export const useTyping = () =>
  useQuery({ queryKey: keys.live, queryFn: () => [] as Typing[], enabled: false, initialData: [] as Typing[] }).data;
