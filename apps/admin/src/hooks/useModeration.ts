// Очередь модерации «Ленты»: четыре очереди «ждут решения» из тех же запросов, что у «Каталога» и «Мастеров» (кэш общий),
// и решения теми же действиями, что у кнопок родных экранов, — по одной строке и пачкой.
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api.ts';
import type { Decision, DecisionCall, ModerationRow } from '../lib/moderation.ts';
import { batchPlan, batchSummary, decisionCall, moderationQueue } from '../lib/moderation.ts';
import { POLL_MS, useCatalogActions, useCollectedEvents } from './useCollectedEvents.ts';
import { useHosts, useHostStatus, usePracticeStatus } from './useHosts.ts';
import { useJobs, useJobUpdate } from './useJobs.ts';
import { useOverview } from './useOverview.ts';

/** Тот же вызов, что делает действие строки на родном экране. */
const send = (call: DecisionCall): Promise<unknown> =>
  call.kind === 'event' ? api.collectedUpdate(call.input.id, call.input.input)
  : call.kind === 'service' ? api.practiceUpdate(call.input.practice_id, { status: call.input.status })
  : call.kind === 'host' ? api.hostUpdate(call.input.id, { status: call.input.status })
  : api.jobUpdate(call.input.id, call.input.input);

export function useModeration() {
  const client = useQueryClient();
  const events = useCollectedEvents().data;
  const hosts = useHosts(POLL_MS).data;
  const jobs = useJobs({ status: 'pending' }, POLL_MS);
  const overview = useOverview();
  const groups = moderationQueue({ events, hosts, jobs: jobs.entries, hostEvents: new Map(overview?.hosts.map((h) => [h.username, h.events])) });

  const event = useCatalogActions().update;
  const service = usePracticeStatus();
  const host = useHostStatus();
  const job = useJobUpdate();
  const [busy, setBusy] = useState(false);

  /** Один вызов; ошибку тостом показывает useAct, сюда — только исход. */
  const run = (call: DecisionCall) => new Promise<boolean>((resolve) => {
    const on = { onSuccess: () => resolve(true), onError: () => resolve(false) };
    if (call.kind === 'event') event(call.input, on);
    else if (call.kind === 'service') service(call.input, on);
    else if (call.kind === 'host') host(call.input, on);
    else job(call.input, on);
  });

  return {
    groups,
    /** Идёт пачка: кнопки заперты — исход вызова узнаёт только последний вызов действия, второй сбил бы очередь. */
    busy,
    /** Остальные страницы вакансий: счётчик и «выбрать всё» знают только загруженные. */
    moreJobs: { more: !!jobs.hasNextPage, loading: jobs.isFetchingNextPage, onMore: () => void jobs.fetchNextPage() },
    decide: (row: ModerationRow, decision: Decision) => void run(decisionCall(row, decision)),
    /**
     * Пачка: вызовы по очереди, каждый — отдельная запись журнала (отменить — оттуда). Напрямую через api, а не через
     * действия строк: иначе на 20 решений было бы 20 тостов и 20 перечитываний. Один итоговый тост, одно перечитывание.
     * Возвращает ключи строк, по которым не получилось: они остаются выбранными.
     */
    decideMany: async (selected: ReadonlySet<string>, decision: Decision) => {
      setBusy(true);
      const failed = new Set<string>();
      const plan = batchPlan(groups, selected, decision);
      for (const { row, call } of plan) await send(call).catch(() => failed.add(row.key));
      await client.invalidateQueries();
      setBusy(false);
      const summary = batchSummary(decision, plan.length - failed.size, failed.size);
      if (failed.size) toast.warning(summary);
      else toast.success(summary);
      return failed;
    },
  };
}
