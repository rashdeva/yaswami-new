import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { JobItem } from '@yaswami/core';
import { track } from '../analytics.ts';
import { api } from '../api.ts';
import { openExternal } from '../tg.ts';
import { keys } from './keys.ts';

/** Вакансии города, свежие сверху, страницами: `more` — подгрузить следующую, null — больше нет. */
export function useJobs() {
  const { data, error, hasNextPage, isFetchingNextPage, fetchNextPage } = useInfiniteQuery({
    queryKey: keys.jobs,
    queryFn: ({ pageParam }) => api.listJobs({ pagination_cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.has_more ? last.next_cursor ?? undefined : undefined),
  });
  return {
    jobs: data?.pages.flatMap((p) => p.entries) ?? null,
    failed: error,
    more: hasNextPage ? () => void fetchNextPage() : null,
    loadingMore: isFetchingNextPage,
  };
}

/** Есть ли хоть одна опубликованная вакансия: по нему показываем вход в раздел. Пока не знаем — входа нет. */
export function useHasJobs() {
  const { data } = useQuery({ queryKey: keys.jobsExist, queryFn: () => api.listJobs({ pagination_limit: 1 }), staleTime: 5 * 60_000 });
  return !!data?.entries.length;
}

/** Одна вакансия. `failed` с текстом «Вакансия не найдена» — её нет, она не одобрена или объявлению больше 30 дней. */
export function useJob(id: string) {
  const { data, error } = useQuery({ queryKey: keys.job(id), queryFn: () => api.getJob(id) });
  return { job: data ?? null, failed: error };
}

/** «Написать» работодателю: чат в Telegram с готовым текстом. Отклик не храним — нажатие видно только в аналитике. */
export function contactJob(job: Pick<JobItem, 'id' | 'title' | 'contact_url'>) {
  track('job_contact_clicked', { job_id: job.id, title: job.title });
  openExternal(job.contact_url);
}
