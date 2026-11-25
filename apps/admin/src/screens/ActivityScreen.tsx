// «Активность»: кто пришёл и откуда, кто куда записался, какие события открывал — новое сверху, отбор вкладками.
import type { ActivityFilter } from '@yaswami/core';
import { ActivityFeed } from '@/components/ActivityFeed';
import { Failed, Loading, LoadMore, Nothing, Page } from '@/components/Page';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useActivity } from '@/hooks/useActivity';
import { ACTIVITY_TABS } from '@/lib/activity';

export function ActivityScreen({ type, onType }: { type?: ActivityFilter; onType: (type: ActivityFilter | undefined) => void }) {
  const { entries, error, isPending, hasNextPage, isFetchingNextPage, fetchNextPage } = useActivity({ type });
  return (
    <Page title="Активность" description="Кто пришёл и откуда, кто куда записался и какие события открывал. Новое сверху, обновляется само.">
      <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={type ?? 'all'} onValueChange={(v) => v && onType(v === 'all' ? undefined : (v as ActivityFilter))}>
        {ACTIVITY_TABS.map(([key, label]) => <ToggleGroupItem key={key} value={key}>{label}</ToggleGroupItem>)}
      </ToggleGroup>
      {isPending && <Loading rows={8} />}
      {error && <Failed error={error} />}
      {entries?.length === 0 && <Nothing title="Пока пусто" hint="Под этот отбор ничего не было." />}
      {!!entries?.length && <ActivityFeed entries={entries} />}
      <LoadMore more={!!hasNextPage} loading={isFetchingNextPage} onMore={() => void fetchNextPage()} />
    </Page>
  );
}
