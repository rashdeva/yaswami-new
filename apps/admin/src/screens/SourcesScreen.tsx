// «Источники»: каналы и группы, откуда сборщик берёт анонсы. Каналы организаторов он добавляет сам; ненужный — выключить.
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSources } from '@/hooks/useSources';

// Закрытый чат задаётся id (-100…): ссылки на него нет.
const link = (channel: string) => (channel.startsWith('-') ? null : `https://t.me/${channel}`);

export function SourcesScreen() {
  const { sources, create, toggle } = useSources();
  const [channel, setChannel] = useState('');
  return (
    <div className="h-full overflow-y-auto p-5 pb-16">
      <h2 className="flex items-center gap-2 font-medium">Источники <Badge>{sources?.filter((s) => s.enabled).length ?? 0}</Badge></h2>
      <p className="mb-3 max-w-2xl text-xs text-muted-foreground">
        Каналы и группы, из которых сборщик берёт анонсы. Канал организатора добавляется сам, когда сборщик находит его в профиле, — по несколько за проход.
        Канал оказался чужим или не про события — выключите: сборщик перестанет его читать и не добавит снова.
      </p>
      <form className="mb-4 flex max-w-md gap-2" onSubmit={(e) => { e.preventDefault(); if (channel.trim()) { create(channel.trim()); setChannel(''); } }}>
        <Input placeholder="@channel или t.me/channel" value={channel} onChange={(e) => setChannel(e.target.value)} />
        <Button type="submit" variant="outline">Добавить</Button>
      </form>
      {!sources && <p className="text-xs text-muted-foreground">Загружаю…</p>}
      {sources && (
        <Table>
          <TableHeader>
            <TableRow><TableHead>Канал</TableHead><TableHead>Откуда</TableHead><TableHead>Событий</TableHead><TableHead /></TableRow>
          </TableHeader>
          <TableBody>
            {sources.map((s) => (
              <TableRow key={s.channel} className={s.enabled ? '' : 'text-muted-foreground'}>
                <TableCell>{link(s.channel) ? <a className="underline" href={link(s.channel)!} target="_blank" rel="noreferrer">@{s.channel}</a> : s.channel}</TableCell>
                <TableCell className="text-xs">
                  {s.host ? <>канал организатора <a className="underline" href={`https://t.me/${s.host.username}`} target="_blank" rel="noreferrer">{s.host.name}</a></> : 'добавлен командой'}
                </TableCell>
                <TableCell>{s.events_count}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" onClick={() => toggle({ channel: s.channel, enabled: !s.enabled })}>{s.enabled ? 'Выключить' : 'Включить'}</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
