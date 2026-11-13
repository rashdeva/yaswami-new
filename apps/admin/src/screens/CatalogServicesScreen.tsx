// «Каталог → Услуги»: услуги мастеров (Practice), найденные сборщиком в чатах. Новая ждёт решения; одобренная видна
// во вкладке «Услуги» приложения; отклонённая остаётся в базе. Поля услуги правятся в карточке мастера.
import type { PracticeStatus } from '@yaswami/core';
import { OTHER_TOPIC, PRACTICE_STATUSES } from '@yaswami/core';
import { EntityLink, TelegramLink } from '@/components/EntityLink';
import { Failed, Loading, Nothing, Page } from '@/components/Page';
import { Search } from '@/components/Search';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Item, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useHosts, usePracticeStatus } from '@/hooks/useHosts';
import { PRACTICE_LABELS } from '@/lib/catalog';

export type CatalogKind = 'events' | 'services';
export type ServiceFilter = 'all' | PracticeStatus;

/** Что показывает «Каталог»: собранные события или услуги мастеров. */
export function KindToggle({ kind, onKind }: { kind: CatalogKind; onKind: (kind: CatalogKind) => void }) {
  return (
    <ButtonGroup>
      <Button size="sm" variant={kind === 'events' ? 'default' : 'outline'} onClick={() => onKind('events')}>События</Button>
      <Button size="sm" variant={kind === 'services' ? 'default' : 'outline'} onClick={() => onKind('services')}>Услуги</Button>
    </ButtonGroup>
  );
}

const HINTS: Record<ServiceFilter, string> = {
  all: 'Все услуги мастеров.',
  pending: 'Сборщик нашёл услугу в самопредставлении мастера. В приложении её нет, пока вы её не одобрите.',
  published: 'Видны во вкладке «Услуги». Услугу можно снять.',
  rejected: 'Не выводятся нигде. Остаются у мастера, чтобы было видно, что решение уже принято.',
};

interface Props {
  status: ServiceFilter;
  query: string;
  onFilter: (filter: { status: ServiceFilter; query: string }) => void;
  onKind: (kind: CatalogKind) => void;
}

export function CatalogServicesScreen({ status, query, onFilter, onKind }: Props) {
  const { data: hosts, error } = useHosts();
  const decide = usePracticeStatus();
  const q = query.trim().toLowerCase().replace(/^@/, '');
  const all = (hosts ?? []).flatMap((h) => h.practices.map((p) => ({ h, p, signups: h.practice_signup_counts[p.id] ?? 0 })));
  const list = all
    .filter(({ h, p }) => (status === 'all' || p.status === status) && (!q || [p.title, p.topic, h.name, h.username].some((s) => s.toLowerCase().includes(q))))
    .sort((a, b) => b.signups - a.signups || a.p.title.localeCompare(b.p.title));
  const tabs: [ServiceFilter, string][] = [['all', 'Все'], ...PRACTICE_STATUSES.map((s) => [s, PRACTICE_LABELS[s]] as [ServiceFilter, string])];

  return (
    <Page title="Каталог" description={HINTS[status]}>
      <KindToggle kind="services" onKind={onKind} />
      <Tabs value={status} onValueChange={(v) => onFilter({ status: v as ServiceFilter, query })}>
        <TabsList className="h-auto flex-wrap">
          {tabs.map(([key, label]) => (
            <TabsTrigger key={key} value={key}>{label} {hosts && <Badge variant="secondary">{all.filter((x) => key === 'all' || x.p.status === key).length}</Badge>}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Search value={query} onChange={(e) => onFilter({ status, query: e.target.value })} placeholder="Услуга, тема, имя или @username" />
      {!hosts && !error && <Loading />}
      {error && <Failed error={error} />}
      {hosts && list.length === 0 && <Nothing title={status === 'pending' && !query ? 'Новых услуг нет' : 'Ничего не нашлось'} />}
      {list.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow><TableHead>Услуга</TableHead><TableHead>Мастер</TableHead><TableHead>Цена</TableHead><TableHead>Заявок</TableHead><TableHead>Статус</TableHead><TableHead /></TableRow>
          </TableHeader>
          <TableBody>
            {list.map(({ h, p, signups }) => (
              <TableRow key={p.id}>
                <TableCell className="max-w-sm whitespace-normal">
                  <Item size="xs" className="p-0">
                    <ItemContent>
                      <ItemTitle>{p.title}</ItemTitle>
                      <ItemDescription>{[p.topic, p.description].filter(Boolean).join(' · ')}</ItemDescription>
                    </ItemContent>
                  </Item>
                </TableCell>
                <TableCell>
                  <Item size="xs" className="p-0">
                    <ItemContent>
                      <ItemTitle><EntityLink entity="host" id={h.id}>{h.name}</EntityLink></ItemTitle>
                      <ItemDescription><TelegramLink username={h.username} /></ItemDescription>
                    </ItemContent>
                  </Item>
                </TableCell>
                <TableCell>{p.price ?? '—'}</TableCell>
                <TableCell>{signups}</TableCell>
                <TableCell>
                  <Badge variant={p.status === 'pending' ? 'default' : p.status === 'rejected' ? 'outline' : 'secondary'}>{PRACTICE_LABELS[p.status]}</Badge>
                  {/* Одобренная, но в приложении не видна: тема не из наших или мастер отклонён целиком. */}
                  {p.status === 'published' && (p.topic === OTHER_TOPIC || h.status === 'rejected') && <> <Badge variant="outline">{h.status === 'rejected' ? 'мастер отклонён' : 'не наша тема'}</Badge></>}
                </TableCell>
                <TableCell>
                  <ButtonGroup className="justify-end">
                    {p.status !== 'published' && <Button size="xs" onClick={() => decide({ host_id: h.id, practice_id: p.id, status: 'published' })}>Одобрить</Button>}
                    {p.status !== 'rejected' && (
                      <Button size="xs" variant="outline" onClick={() => decide({ host_id: h.id, practice_id: p.id, status: 'rejected' })}>{p.status === 'pending' ? 'Отклонить' : 'Снять'}</Button>
                    )}
                  </ButtonGroup>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Page>
  );
}
