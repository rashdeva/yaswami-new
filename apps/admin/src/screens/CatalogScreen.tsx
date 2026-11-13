// «Каталог»: события, собранные из анонсов. Новое ждёт решения; одобренное проходит обработку (обложка и ролик)
// и выходит в ленту; опубликованное можно снять или удалить. «По одному» — очередь ждущих решения с правкой полей.
// Поиск и отбор по статусу — в адресе.
import type { AdminCollectedEvent, CollectedStatus } from '@yaswami/core';
import { COLLECTED_STATUSES, collectedWhen } from '@yaswami/core';
import { Cover } from '@/components/Cover';
import { CityBadge } from '@/components/City';
import { EntityLink, ExternalLink } from '@/components/EntityLink';
import { Failed, Loading, Nothing, Page } from '@/components/Page';
import { Search } from '@/components/Search';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Item, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCatalogActions, useCollectedEvents, useCovers } from '@/hooks/useCollectedEvents';
import { CatalogQueueScreen } from '@/screens/CatalogQueueScreen';
import type { CatalogKind } from '@/screens/CatalogServicesScreen';
import { KindToggle } from '@/screens/CatalogServicesScreen';
import { COLLECTED_LABELS, matchCollected } from '@/lib/catalog';

export type CatalogFilter = 'all' | CollectedStatus | 'covers' | 'queue';

const HINTS: Record<CatalogFilter, string> = {
  all: 'Все собранные события.',
  pending: 'Сборщик разобрал анонс. В ленте события нет, пока вы его не одобрите.',
  approved: 'Одобрены: иллюстратор делает обложку и ролик, после этого событие само выйдет в ленту.',
  published: 'Видны всем. Событие можно снять с публикации или удалить.',
  rejected: 'Не выводятся нигде. Остаются в базе, чтобы повторный анонс не создал событие заново.',
  covers: 'Предстоящие события, обложку которых иллюстратор ещё не посмотрел.',
  queue: 'Ждущие решения по одному: сверьте поля с текстом анонса, поправьте, если нужно, и решите. В ленте события нет, пока вы его не одобрите.',
};

interface Props {
  status: CatalogFilter;
  query: string;
  onFilter: (filter: { status: CatalogFilter; query: string }) => void;
  /** Переключить каталог на услуги мастеров. */
  onKind: (kind: CatalogKind) => void;
}

export function CatalogScreen({ status, query, onFilter, onKind }: Props) {
  const { data: items, error } = useCollectedEvents();
  const { data: covers } = useCovers();
  const { update } = useCatalogActions();
  const waitingCover = new Set(covers?.map((c) => c.id));
  const inTab = (e: AdminCollectedEvent, tab: CatalogFilter) => (tab === 'all' ? true : tab === 'covers' ? waitingCover.has(e.id) : e.status === (tab === 'queue' ? 'pending' : tab));
  const list = items?.filter((e) => inTab(e, status) && matchCollected(e, query));
  const tabs: [CatalogFilter, string][] = [['queue', 'По одному'], ['all', 'Все'], ...COLLECTED_STATUSES.map((s) => [s, COLLECTED_LABELS[s]] as [CatalogFilter, string]), ['covers', 'Ждут обложки']];

  return (
    <Page title="Каталог" description={HINTS[status]}>
      <KindToggle kind="events" onKind={onKind} />
      <Tabs value={status} onValueChange={(v) => onFilter({ status: v as CatalogFilter, query })}>
        <TabsList className="h-auto flex-wrap">
          {tabs.map(([key, label]) => (
            <TabsTrigger key={key} value={key}>{label} {items && <Badge variant="secondary">{items.filter((e) => inTab(e, key)).length}</Badge>}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {status !== 'queue' && <Search value={query} onChange={(e) => onFilter({ status, query: e.target.value })} placeholder="Название, место или источник" />}
      {status === 'queue' && <CatalogQueueScreen />}
      {status !== 'queue' && (
        <>
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
                    <TableCell><Cover url={e.cover_url} className="w-9" /></TableCell>
                    <TableCell className="max-w-sm whitespace-normal">
                      <Item size="xs" className="p-0">
                        <ItemContent>
                          <ItemTitle><EntityLink entity="collected_event" id={e.id}>{e.title}</EntityLink></ItemTitle>
                          <ItemDescription>{[e.place, e.price, e.topic].filter(Boolean).join(' · ')}</ItemDescription>
                        </ItemContent>
                      </Item>
                    </TableCell>
                    <TableCell>{collectedWhen(e.starts_at)}</TableCell>
                    <TableCell><ExternalLink href={e.source_url}>{e.channel}</ExternalLink> <CityBadge id={e.city_id} /></TableCell>
                    <TableCell><Badge variant={e.status === 'pending' ? 'default' : e.status === 'rejected' ? 'outline' : 'secondary'}>{COLLECTED_LABELS[e.status]}</Badge></TableCell>
                    <TableCell>
                      <ButtonGroup className="justify-end">
                      {(e.status === 'pending' || e.status === 'rejected') && <Button size="xs" onClick={() => update({ id: e.id, input: { status: 'approved' } })}>Одобрить</Button>}
                      {e.status !== 'rejected' && (
                        <Button size="xs" variant="outline" onClick={() => update({ id: e.id, input: { status: 'rejected' } })}>{e.status === 'pending' ? 'Отклонить' : 'Снять'}</Button>
                      )}
                      </ButtonGroup>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}
    </Page>
  );
}
