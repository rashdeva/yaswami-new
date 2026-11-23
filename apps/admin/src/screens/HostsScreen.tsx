// «Мастера»: профили организаторов и мастеров, собранные по открытым анонсам, и на каком шаге переписка с каждым.
// Вкладки — решение команды по профилю (сначала те, кто его ждёт), отбор ниже — кто это: организатор с событиями,
// мастер с услугами или человек без того и другого. Услуги проходят модерацию в «Каталоге».
import type { HostStatus } from '@yaswami/core';
import { HOST_STATUSES, INBOX_STAGES } from '@yaswami/core';
import { useState } from 'react';
import { CityBadge } from '@/components/City';
import { EntityLink, TelegramLink } from '@/components/EntityLink';
import { Failed, Hint, Loading, Nothing, Page } from '@/components/Page';
import { Search } from '@/components/Search';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Input } from '@/components/ui/input';
import { Item, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useHostCreate, useHosts, useHostStatus } from '@/hooks/useHosts';
import { useOverview } from '@/hooks/useOverview';
import type { HostKind } from '@/lib/catalog';
import { HOST_KINDS, HOST_LABELS, hostKind } from '@/lib/catalog';

export type HostFilter = 'all' | HostStatus;

const TABS: [HostFilter, string][] = [['pending', 'Ждут решения'], ...HOST_STATUSES.filter((s) => s !== 'pending').map((s) => [s, HOST_LABELS[s]] as [HostFilter, string]), ['all', 'Все']];
const HINTS: Record<HostFilter, string> = {
  pending: 'Новые профили, свежие сверху: сверьте, что это организатор или мастер, и решите. «Проверяется» — добавлен по username, сборщик ещё не нашёл его в Telegram.',
  published: 'Проверены командой.',
  rejected: 'Скрыты вместе со всеми событиями и услугами. Остаются в базе, чтобы сборщик не завёл профиль заново.',
  all: 'Все профили. «Записей» — сколько раз на предстоящие события организатора нажали «Записаться» у нас.',
};

interface Props {
  status: HostFilter;
  /** Кто это; не выбрано — все. */
  kind: HostKind | undefined;
  query: string;
  onFilter: (filter: { status: HostFilter; kind: HostKind | undefined; query: string }) => void;
  onOpen: (conversation: string) => void;
  /** Организатора добавили по username — открыть его карточку. */
  onCreated: (id: string) => void;
}

export function HostsScreen({ status, kind, query, onFilter, onOpen, onCreated }: Props) {
  const create = useHostCreate();
  const decide = useHostStatus();
  const [username, setUsername] = useState('');
  const { data: hosts, error } = useHosts();
  const overview = useOverview();
  const stats = new Map(overview?.hosts.map((h) => [h.username, h]));
  const q = query.trim().toLowerCase().replace(/^@/, '');
  // Поиск действует на счётчики вкладок и отбора: по ним видно, где лежит найденный.
  const found = (hosts ?? [])
    .filter((h) => !q || [h.name, h.username, h.channel].some((s) => s?.toLowerCase().includes(q)))
    .map((h) => ({ h, s: stats.get(h.username), kind: hostKind(stats.get(h.username)?.events ?? 0, h.practices.length) }));
  const inTab = (r: (typeof found)[number], tab: HostFilter) => tab === 'all' || r.h.status === tab;
  const ofKind = found.filter((r) => !kind || r.kind === kind);
  const rows = ofKind
    .filter((r) => inTab(r, status))
    .sort((a, b) => status === 'pending'
      ? b.h.created_at.localeCompare(a.h.created_at)
      : (b.s?.signups ?? 0) - (a.s?.signups ?? 0) || (b.s?.events ?? 0) - (a.s?.events ?? 0));

  return (
    <Page title={<>Мастера <Badge>{hosts?.length ?? '…'}</Badge></>} description={`${HINTS[status]} Нужного нет — добавьте по username: сборщик найдёт его в Telegram и заполнит профиль.`}>
      <form className="flex max-w-md gap-2" onSubmit={(e) => (e.preventDefault(), username.trim() && create({ username: username.trim() }, { onSuccess: (h) => (setUsername(''), onCreated(h.id)) }))}>
        <Input placeholder="@username или t.me/username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <Button type="submit" variant="outline">Добавить</Button>
      </form>
      <Tabs value={status} onValueChange={(v) => onFilter({ status: v as HostFilter, kind, query })}>
        <TabsList className="h-auto flex-wrap">
          {TABS.map(([key, label]) => (
            <TabsTrigger key={key} value={key}>{label} {hosts && <Badge variant={key === 'pending' ? 'default' : 'secondary'}>{ofKind.filter((r) => inTab(r, key)).length}</Badge>}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <ToggleGroup type="single" variant="outline" size="sm" value={kind ?? ''} onValueChange={(v) => onFilter({ status, kind: (v || undefined) as HostKind | undefined, query })}>
        {(Object.keys(HOST_KINDS) as HostKind[]).map((k) => (
          <ToggleGroupItem key={k} value={k}>{HOST_KINDS[k]} <Badge variant="secondary">{found.filter((r) => r.kind === k && inTab(r, status)).length}</Badge></ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Search value={query} onChange={(e) => onFilter({ status, kind, query: e.target.value })} placeholder="Имя, @username или канал" />
      {!hosts && !error && <Loading />}
      {error && <Failed error={error} />}
      {hosts && rows.length === 0 && <Nothing title={status === 'pending' && !q && !kind ? 'Все профили разобраны' : 'Никого не нашлось'} />}
      {rows.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow><TableHead>Организатор</TableHead><TableHead>Статус</TableHead><TableHead>Услуги и о нём</TableHead><TableHead>Событий</TableHead><TableHead>Записей</TableHead><TableHead>В сервисе</TableHead><TableHead>Переписка</TableHead><TableHead /></TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ h, s, kind: k }) => (
              <TableRow key={h.id}>
                <TableCell className="align-top">
                  <Item size="xs" className="p-0">
                    <ItemContent>
                      <ItemTitle><EntityLink entity="host" id={h.id}>{h.name}</EntityLink></ItemTitle>
                      <ItemDescription><TelegramLink username={h.username} /></ItemDescription>
                      {h.channel && <ItemDescription>канал <TelegramLink username={h.channel} /></ItemDescription>}
                      <ItemDescription><CityBadge id={h.city_id} /></ItemDescription>
                    </ItemContent>
                  </Item>
                </TableCell>
                <TableCell className="align-top"><Badge variant={h.status === 'pending' ? 'default' : h.status === 'rejected' ? 'outline' : 'secondary'}>{HOST_LABELS[h.status]}</Badge> <Badge variant="outline">{HOST_KINDS[k]}</Badge>{!h.telegram_id && h.status === 'pending' && <> <Badge variant="outline">проверяется</Badge></>}
                </TableCell>
                <TableCell className="max-w-md align-top whitespace-normal"><Hint>{h.practices.length ? h.practices.map((p) => p.title).join(' · ') : h.summary ?? '—'}</Hint></TableCell>
                <TableCell>{s?.events ?? 0}</TableCell>
                <TableCell>{s?.signups ?? 0}</TableCell>
                <TableCell>
                  {h.user_id ? <Badge variant="outline"><EntityLink entity="user" id={h.user_id}>вошёл</EntityLink></Badge> : <Hint>нет</Hint>}
                </TableCell>
                <TableCell>
                  {s?.conversation_id
                    ? <Button variant="outline" size="xs" onClick={() => onOpen(s.conversation_id!)}>{INBOX_STAGES[s.stage!]}</Button>
                    : <Hint>не писали</Hint>}
                </TableCell>
                <TableCell>
                  <ButtonGroup className="justify-end">
                    {h.status !== 'published' && <Button size="xs" onClick={() => decide({ id: h.id, status: 'published' })}>{h.status === 'rejected' ? 'Вернуть' : 'Проверен'}</Button>}
                    {h.status !== 'rejected' && <Button size="xs" variant="outline" onClick={() => decide({ id: h.id, status: 'rejected' })}>Отклонить</Button>}
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
