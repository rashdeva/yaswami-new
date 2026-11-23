// Вакансии «Каталога»: список по статусу с подгрузкой и правки команды (решение модератора или поля).
import { useInfiniteQuery } from '@tanstack/react-query';
import type { AdminJobListInput, JobUpdateInput } from '@yaswami/core';
import { api } from '../api.ts';
import { keys } from './keys.ts';
import { useAct } from './useAct.ts';

export type JobFilter = Pick<AdminJobListInput, 'status'>;

/** Вакансии, свежие сверху; следующая страница — по `next_cursor`. `poll` — перечитывать раз в столько мс (очередь модерации в «Ленте»). */
export function useJobs(filter: JobFilter, poll?: number) {
  const q = useInfiniteQuery({
    queryKey: keys.jobs(filter),
    queryFn: ({ pageParam }) => api.jobs({ ...filter, pagination_cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    refetchInterval: poll,
  });
  return { ...q, entries: q.data?.pages.flatMap((p) => p.entries) };
}

/** Решение по вакансии (`status`) или правка её полей — одно действие `admin_jobs_update`, отменяется из тоста и журнала. */
export const useJobUpdate = () =>
  useAct(({ id, input }: { id: string; input: JobUpdateInput }) => api.jobUpdate(id, input), { undo: ({ id }) => ['job', id] });
