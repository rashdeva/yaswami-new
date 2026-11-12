// «Организаторы»: профили, собранные по открытым анонсам, и на каком шаге переписка с каждым.
import { INBOX_STAGES } from '@yaswami/core';
import { EntityLink } from '@/components/EntityLink';
import { Failed, Loading, Nothing, Page } from '@/components/Page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useHosts } from '@/hooks/useHosts';
import { useOverview } from '@/hooks/useOverview';

interface Props {
  query: string;
  onQuery: (query: string) => void;
  onOpen: (conversation: string) => void;
}

export function HostsScreen({ query, onQuery, onOpen }: Props) {
  const { data: hosts, error } = useHosts();
  const overview = useOverview();
  const stats = new Map(overview?.hosts.map((h) => [h.telegram_id, h]));
  const q = query.trim().toLowerCase().replace(/^@/, '');
  const rows = (hosts ?? [])
    .filter((h) => !q || [h.name, h.username, h.channel].some((s) => s?.toLowerCase().includes(q)))
    .map((h) => ({ h, s: stats.get(h.telegram_id) }))
    .sort((a, b) => (b.s?.signups ?? 0) - (a.s?.signups ?? 0) || (b.s?.events ?? 0) - (a.s?.events ?? 0));

  return (
    <Page title={<>Организаторы <Badge>{hosts?.length ?? '…'}</Badge></>}>
      <p className="text-xs text-muted-foreground">Профили собраны по открытым анонсам. «Записей» — сколько раз на предстоящие события организатора нажали «Записаться» у нас.</p>
      <Input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Имя, @username или канал" />
      {!hosts && !error && <Loading />}
      {error && <Failed error={error} />}
      {hosts && rows.length === 0 && <Nothing title="Никого не нашлось" />}
      {rows.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow><TableHead>Организатор</TableHead><TableHead>О нём</TableHead><TableHead>Событий</TableHead><TableHead>Записей</TableHead><TableHead>В сервисе</TableHead><TableHead>Переписка</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ h, s }) => (
              <TableRow key={h.id}>
                <TableCell className="align-top">
                  <strong><EntityLink entity="host" id={h.id}>{h.name}</EntityLink></strong>
                  <div><a className="text-xs underline" href={`https://t.me/${h.username}`} target="_blank" rel="noreferrer">@{h.username}</a></div>
                  {h.channel && <div className="text-xs text-muted-foreground">канал <a className="underline" href={`https://t.me/${h.channel}`} target="_blank" rel="noreferrer">@{h.channel}</a></div>}
                </TableCell>
                <TableCell className="max-w-md align-top text-xs whitespace-normal text-muted-foreground">{h.summary ?? '—'}</TableCell>
                <TableCell>{s?.events ?? 0}</TableCell>
                <TableCell>{s?.signups ?? 0}</TableCell>
                <TableCell>
                  {h.user_id ? <Badge variant="outline"><EntityLink entity="user" id={h.user_id}>вошёл</EntityLink></Badge> : <span className="text-xs text-muted-foreground">нет</span>}
                </TableCell>
                <TableCell>
                  {s?.conversation_id
                    ? <Button variant="link" size="sm" className="px-0" onClick={() => onOpen(s.conversation_id!)}>{INBOX_STAGES[s.stage!]}</Button>
                    : <span className="text-xs text-muted-foreground">не писали</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Page>
  );
}
