// «Организаторы»: профили, собранные по открытым анонсам, и на каком шаге переписка с каждым.
import { INBOX_STAGES } from '@yaswami/core';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useOverview } from '@/hooks/useOverview';

export function HostsScreen({ onOpen }: { onOpen: (conversation: string) => void }) {
  const overview = useOverview();
  const hosts = [...(overview?.hosts ?? [])].sort((a, b) => b.signups - a.signups || b.events - a.events);
  return (
    <div className="h-full overflow-y-auto p-5 pb-16">
      <h2 className="flex items-center gap-2 font-medium">Организаторы <Badge>{hosts.length}</Badge></h2>
      <p className="mb-3 text-xs text-muted-foreground">Профили собраны по открытым анонсам. «Записей» — сколько раз на предстоящие события организатора нажали «Записаться» у нас.</p>
      {!overview && <p className="text-xs text-muted-foreground">Загружаю…</p>}
      {overview && (
        <Table>
          <TableHeader>
            <TableRow><TableHead>Организатор</TableHead><TableHead>О нём</TableHead><TableHead>Событий</TableHead><TableHead>Записей</TableHead><TableHead>В сервисе</TableHead><TableHead>Переписка</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {hosts.map((h) => (
              <TableRow key={h.telegram_id}>
                <TableCell className="align-top">
                  <strong>{h.name}</strong>
                  <div><a className="underline" href={`https://t.me/${h.username}`} target="_blank" rel="noreferrer">@{h.username}</a></div>
                  {h.channel && <div className="text-xs text-muted-foreground">канал <a className="underline" href={`https://t.me/${h.channel}`} target="_blank" rel="noreferrer">@{h.channel}</a></div>}
                </TableCell>
                <TableCell className="max-w-md align-top text-xs whitespace-normal text-muted-foreground">{h.summary ?? '—'}</TableCell>
                <TableCell>{h.events}</TableCell>
                <TableCell>{h.signups}</TableCell>
                <TableCell>{h.registered ? <Badge variant="outline" className="border-green-600/40 text-green-700 dark:text-green-400">вошёл</Badge> : <span className="text-xs text-muted-foreground">нет</span>}</TableCell>
                <TableCell>
                  {h.conversation_id
                    ? <Button variant="link" size="sm" className="px-0" onClick={() => onOpen(h.conversation_id!)}>{INBOX_STAGES[h.stage!]}</Button>
                    : <span className="text-xs text-muted-foreground">не писали</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
