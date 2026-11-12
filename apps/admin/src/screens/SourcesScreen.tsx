// «Источники»: каналы и группы, откуда сборщик берёт анонсы. Каналы организаторов он добавляет сам; ненужный — выключить.
import { useState } from 'react';
import { ExternalLink } from '@/components/EntityLink';
import { Failed, Loading, Nothing, Page } from '@/components/Page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSources } from '@/hooks/useSources';

// Закрытый чат задаётся id (-100…): ссылки на него нет.
const link = (channel: string) => (channel.startsWith('-') ? null : `https://t.me/${channel}`);

const DESCRIPTION = 'Каналы и группы, из которых сборщик берёт анонсы. Канал организатора добавляется сам, когда сборщик находит его в профиле, — по несколько за проход. Канал оказался чужим или не про события — выключите: сборщик перестанет его читать и не добавит снова.';

export function SourcesScreen() {
  const { sources: { data: sources, error }, create, toggle } = useSources();
  const [channel, setChannel] = useState('');
  return (
    <Page title={<>Источники <Badge>{sources?.filter((s) => s.enabled).length ?? 0}</Badge></>} description={DESCRIPTION}>
      <form className="flex max-w-md gap-2" onSubmit={(e) => (e.preventDefault(), channel.trim() && create(channel.trim(), { onSuccess: () => setChannel('') }))}>
        <Input placeholder="@channel или t.me/channel" value={channel} onChange={(e) => setChannel(e.target.value)} />
        <Button type="submit" variant="outline">Добавить</Button>
      </form>
      {!sources && !error && <Loading />}
      {error && <Failed error={error} />}
      {sources?.length === 0 && <Nothing title="Источников нет" />}
      {!!sources?.length && (
        <Table>
          <TableHeader>
            <TableRow><TableHead>Канал</TableHead><TableHead>Откуда</TableHead><TableHead>Событий</TableHead><TableHead /></TableRow>
          </TableHeader>
          <TableBody>
            {sources.map((s) => (
              <TableRow key={s.channel} data-state={s.enabled ? undefined : 'disabled'}>
                <TableCell>{link(s.channel) ? <ExternalLink href={link(s.channel)!}>@{s.channel}</ExternalLink> : s.channel} {!s.enabled && <Badge variant="outline">выключен</Badge>}</TableCell>
                <TableCell>
                  {s.host ? <>канал организатора <ExternalLink href={`https://t.me/${s.host.username}`}>{s.host.name}</ExternalLink></> : 'добавлен командой'}
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
    </Page>
  );
}
