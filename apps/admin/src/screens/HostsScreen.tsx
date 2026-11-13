// «Организаторы»: профили, собранные по открытым анонсам, и на каком шаге переписка с каждым.
import { BanIcon, CheckIcon } from 'lucide-react';
import { INBOX_STAGES } from '@yaswami/core';
import { useState } from 'react';
import { EntityLink, TelegramLink } from '@/components/EntityLink';
import { Failed, Hint, Loading, Nothing, Page } from '@/components/Page';
import { Search } from '@/components/Search';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Item, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useHostCreate, useHosts, useHostStatus } from '@/hooks/useHosts';
import { useOverview } from '@/hooks/useOverview';
import { HOST_LABELS } from '@/lib/catalog';

interface Props {
  query: string;
  /** Показывать только ждущих решения мастеров: у кого есть Practice и статус pending. */
  queue: boolean;
  onQueue: (queue: boolean) => void;
  onQuery: (query: string) => void;
  onOpen: (conversation: string) => void;
  /** Организатора добавили по username — открыть его карточку. */
  onCreated: (id: string) => void;
}

export function HostsScreen({ query, queue, onQueue, onQuery, onOpen, onCreated }: Props) {
  const create = useHostCreate();
  const decide = useHostStatus();
  const [username, setUsername] = useState('');
  const { data: hosts, error } = useHosts();
  const overview = useOverview();
  const stats = new Map(overview?.hosts.map((h) => [h.username, h]));
  const q = query.trim().toLowerCase().replace(/^@/, '');
  const waiting = (hosts ?? []).filter((h) => h.status === 'pending' && h.practices.length > 0);
  const rows = (queue ? waiting : hosts ?? [])
    .filter((h) => !q || [h.name, h.username, h.channel].some((s) => s?.toLowerCase().includes(q)))
    .map((h) => ({ h, s: stats.get(h.username) }))
    .sort((a, b) => (b.s?.signups ?? 0) - (a.s?.signups ?? 0) || (b.s?.events ?? 0) - (a.s?.events ?? 0));

  return (
    <Page title={<>Организаторы <Badge>{hosts?.length ?? '…'}</Badge></>} description="Профили собраны по открытым анонсам. «Записей» — сколько раз на предстоящие события организатора нажали «Записаться» у нас. Нужного нет — добавьте по username: сборщик найдёт его в Telegram и на следующем проходе заполнит имя, «о себе», канал и сводку.">
      <form className="flex max-w-md gap-2" onSubmit={(e) => (e.preventDefault(), username.trim() && create(username.trim(), { onSuccess: (h) => (setUsername(''), onCreated(h.id)) }))}>
        <Input placeholder="@username или t.me/username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <Button type="submit" variant="outline">Добавить</Button>
      </form>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={queue ? 'outline' : 'default'} onClick={() => onQueue(false)}>Все</Button>
        <Button size="sm" variant={queue ? 'default' : 'outline'} onClick={() => onQueue(true)}>Ждут решения <Badge variant="secondary">{waiting.length}</Badge></Button>
        <Hint>Мастера из чатов попадают в каталог только после «Опубликовать» — здесь или в их карточке.</Hint>
      </div>
      <Search value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Имя, @username или канал" />
      {!hosts && !error && <Loading />}
      {error && <Failed error={error} />}
      {hosts && rows.length === 0 && <Nothing title="Никого не нашлось" />}
      {rows.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow><TableHead>Организатор</TableHead><TableHead>Статус</TableHead><TableHead>О нём</TableHead><TableHead>Событий</TableHead><TableHead>Записей</TableHead><TableHead>В сервисе</TableHead><TableHead>Переписка</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ h, s }) => (
              <TableRow key={h.id}>
                <TableCell className="align-top">
                  <Item size="xs" className="p-0">
                    <ItemContent>
                      <ItemTitle><EntityLink entity="host" id={h.id}>{h.name}</EntityLink></ItemTitle>
                      <ItemDescription><TelegramLink username={h.username} /></ItemDescription>
                      {h.channel && <ItemDescription>канал <TelegramLink username={h.channel} /></ItemDescription>}
                    </ItemContent>
                  </Item>
                </TableCell>
                <TableCell className="align-top"><Badge variant={h.status === 'published' ? 'default' : 'secondary'}>{HOST_LABELS[h.status]}</Badge>{!h.telegram_id && h.status === 'pending' && <> <Badge variant="outline">проверяется</Badge></>}
                  {/* Решение — сразу из списка; пока сборщик не нашёл его в Telegram, решать не по чему. */}
                  {h.telegram_id && h.status === 'pending' && (
                    <div className="mt-1.5 flex gap-1">
                      <Button size="xs" onClick={() => decide({ id: h.id, status: 'published' })}><CheckIcon />Опубликовать</Button>
                      <Button size="xs" variant="outline" onClick={() => decide({ id: h.id, status: 'rejected' })}><BanIcon />Отклонить</Button>
                    </div>
                  )}
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
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Page>
  );
}
