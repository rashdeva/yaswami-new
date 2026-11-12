// Источники анонсов: список, добавить канал, включить или выключить.
import { useQuery } from '@tanstack/react-query';
import { api } from '../api.ts';
import { keys } from './keys.ts';
import { useAct } from './useAct.ts';

export function useSources() {
  return {
    sources: useQuery({ queryKey: keys.sources, queryFn: api.sources }).data,
    create: useAct(api.sourceCreate),
    toggle: useAct(({ channel, enabled }: { channel: string; enabled: boolean }) => api.sourceUpdate(channel, enabled)),
  };
}
