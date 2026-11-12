// Источники анонсов: список, добавить канал, включить или выключить. Оба действия отменяются из тоста.
import { useQuery } from '@tanstack/react-query';
import { api } from '../api.ts';
import { keys } from './keys.ts';
import { useAct } from './useAct.ts';

const undo = (_input: unknown, source: { channel: string }) => ['source', source.channel] as ['source', string];

export function useSources() {
  return {
    sources: useQuery({ queryKey: keys.sources, queryFn: api.sources }),
    create: useAct(api.sourceCreate, { undo }),
    toggle: useAct(({ channel, enabled }: { channel: string; enabled: boolean }) => api.sourceUpdate(channel, enabled), { undo }),
  };
}
