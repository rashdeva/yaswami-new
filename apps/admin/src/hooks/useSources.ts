// Источники анонсов: список, добавить канал, включить или выключить, указать организатора. Действия отменяются из тоста.
import { useQuery } from '@tanstack/react-query';
import type { SourceUpdateInput } from '@yaswami/core';
import { api } from '../api.ts';
import { keys } from './keys.ts';
import { useAct } from './useAct.ts';

const undo = (_input: unknown, source: { channel: string }) => ['source', source.channel] as ['source', string];

export function useSources() {
  return {
    sources: useQuery({ queryKey: keys.sources, queryFn: api.sources }),
    create: useAct(api.sourceCreate, { undo }),
    update: useAct(({ channel, ...input }: { channel: string } & SourceUpdateInput) => api.sourceUpdate(channel, input), { undo }),
  };
}
