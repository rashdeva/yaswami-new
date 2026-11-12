// «Каталог»: события, собранные из анонсов. Новое ждёт решения; одобренное проходит обработку (обложка и ролик)
// и выходит в ленту; опубликованное можно снять или удалить. Поиск и отбор по статусу — в адресе.
import type { AdminCollectedEvent, CollectedStatus } from '@yaswami/core';
import { COLLECTED_STATUSES, collectedWhen } from '@yaswami/core';
import { EntityLink } from '@/components/EntityLink';
import { Failed, Loading, Nothing, Page } from '@/components/Page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCatalogActions, useCollectedEvents, useCovers } from '@/hooks/useCollectedEvents';
import { COLLECTED_LABELS, matchCollected } from '@/lib/catalog';

export type CatalogFilter = 'all' | CollectedStatus | 'covers';

const HINTS: Record<CatalogFilter, string> = {
  all: 'Все собранные события.',
  pending: 'Сборщик разобрал анонс. В ленте события нет, пока вы его не одобрите.',
  approved: 'Одобрены: иллюстратор делает обложку и ролик, после этого событие само выйдет в ленту.',
  published: 'Видны всем. Событие можно снять с публикации или удалить.',
  rejected: 'Не выводятся нигде. Остаются в базе, чтобы повторный анонс не создал событие заново.',
  covers: 'Предстоящие события, обложку которых иллюстратор ещё не посмотрел.',
};

interface Props {
  status: CatalogFilter;
  query: string;
  onFilter: (filter: { status: CatalogFilter; query: string }) => void;
}

export function CatalogScreen({ status, query, onFilter }: Props) {
  const { data: items, error } = useCollectedEvents();
  const { data: covers } = useCovers();
  const { update } = useCatalogActions();
  const waitingCover = new Set(covers?.map((c) => c.id));
  const inTab = (e: AdminCollectedEvent, tab: CatalogFilter) => (tab === 'all' ? true : tab === 'covers' ? waitingCover.has(e.id) : e.status === tab);
  const list = items?.filter((e) => inTab(e, status) && matchCollected(e, query));
  const tabs: [CatalogFilter, string][] = [['all', 'Все'], ...COLLECTED_STATUSES.map((s) => [s, COLLECTED_LABELS[s]] as [CatalogFilter, string]), ['covers', 'Ждут обложки']];

  return (
    <Page title="Каталог">
      <Input value={query} onChange={(e) => onFilter({ status, query: e.target.value })} placeholder="Название, место или источник" />
      <div className="flex flex-wrap gap-1">
        {tabs.map(([key, label]) => (
          <Button key={key} size="sm" variant={status === key ? 'default' : 'outline'} onClick={() => onFilter({ status: key, query })}>
            {label} {items && <Badge variant="secondary">{items.filter((e) => inTab(e, key)).length}</Badge>}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{HINTS[status]}</p>
      {!items && !error && <Loading />}
      {error && <Failed error={error} />}
      {list?.length === 0 && <Nothing title={status === 'pending' && !query ? 'Новых событий нет' : 'Ничего не нашлось'} />}
      {!!list?.length && (
        <Table>
          <TableHeader>
            <TableRow><TableHead className="w-12" /><TableHead>Событие</TableHead><TableHead>Когда</TableHead><TableHead>Источник</TableHead><TableHead>Статус</TableHead><TableHead /></TableRow>
          </TableHeader>
          <TableBody>
            {list.map((e) => (
              <TableRow key={e.id}>
                <TableCell>
                  {e.cover_url ? <img className="aspect-9/16 w-9 rounded object-cover" src={e.cover_url} alt="" loading="lazy" /> : <div className="aspect-9/16 w-9 rounded bg-muted" />}
                </TableCell>
                <TableCell className="max-w-sm font-medium whitespace-normal">
                  <EntityLink entity="collected_event" id={e.id}>{e.title}</EntityLink>
                  <div className="text-xs font-normal text-muted-foreground">{[e.place, e.price, e.topic].filter(Boolean).join(' · ')}</div>
                </TableCell>
                <TableCell className="text-xs">{collectedWhen(e.starts_at)}</TableCell>
                <TableCell className="text-xs"><a className="underline" href={e.source_url} target="_blank" rel="noreferrer">{e.channel}</a></TableCell>
                <TableCell><Badge variant={e.status === 'pending' ? 'default' : e.status === 'rejected' ? 'outline' : 'secondary'}>{COLLECTED_LABELS[e.status]}</Badge></TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {(e.status === 'pending' || e.status === 'rejected') && <Button size="xs" onClick={() => update({ id: e.id, input: { status: 'approved' } })}>Одобрить</Button>}{' '}
                  {e.status !== 'rejected' && (
                    <Button size="xs" variant="outline" onClick={() => update({ id: e.id, input: { status: 'rejected' } })}>{e.status === 'pending' ? 'Отклонить' : 'Снять'}</Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Page>
  );
}
