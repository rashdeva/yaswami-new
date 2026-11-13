// «Источники»: каналы и группы, откуда сборщик берёт анонсы. Каналы организаторов он добавляет сам; ненужный — выключить.
// У источника можно указать организатора — чей это канал — и город: его получают события из этого источника.
import { DEFAULT_CITY_ID } from '@yaswami/core';
import { useState } from 'react';
import { CitySelect } from '@/components/City';
import { EntityLink, ExternalLink } from '@/components/EntityLink';
import { HostPicker } from '@/components/HostPicker';
import { Failed, Loading, Nothing, Page } from '@/components/Page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useHosts } from '@/hooks/useHosts';
import { useSources } from '@/hooks/useSources';

// Закрытый чат задаётся id (-100…): ссылки на него нет.
const link = (channel: string) => (channel.startsWith('-') ? null : `https://t.me/${channel}`);

const DESCRIPTION = 'Каналы и группы, из которых сборщик берёт анонсы. Канал организатора добавляется сам, когда сборщик находит его в профиле, — по несколько за проход. Канал оказался чужим или не про события — выключите: сборщик перестанет его читать и не добавит снова. Если канал ведёт один организатор — укажите его: анонс без контакта для записи получит контактом этого организатора. Нужного нет в списке — добавьте его по username в «Организаторах». Город источника получают события, собранные из него после этого; новый город добавляется в «Городах».';

export function SourcesScreen() {
  const { sources: { data: sources, error }, create, update } = useSources();
  const { data: hosts } = useHosts();
  const [channel, setChannel] = useState('');
  const [city, setCity] = useState<string>(DEFAULT_CITY_ID);
  return (
    <Page title={<>Источники <Badge>{sources?.filter((s) => s.enabled).length ?? 0}</Badge></>} description={DESCRIPTION}>
      <form className="flex max-w-md gap-2" onSubmit={(e) => (e.preventDefault(), channel.trim() && create({ channel: channel.trim(), city_id: city }, { onSuccess: () => setChannel('') }))}>
        <Input placeholder="@channel или t.me/channel" value={channel} onChange={(e) => setChannel(e.target.value)} />
        <CitySelect value={city} onChange={setCity} />
        <Button type="submit" variant="outline">Добавить</Button>
      </form>
      {!sources && !error && <Loading />}
      {error && <Failed error={error} />}
      {sources?.length === 0 && <Nothing title="Источников нет" />}
      {!!sources?.length && (
        <Table>
          <TableHeader>
            <TableRow><TableHead>Канал</TableHead><TableHead>Город</TableHead><TableHead>Организатор</TableHead><TableHead>Событий</TableHead><TableHead /></TableRow>
          </TableHeader>
          <TableBody>
            {sources.map((s) => (
              <TableRow key={s.channel} data-state={s.enabled ? undefined : 'disabled'}>
                <TableCell>{link(s.channel) ? <ExternalLink href={link(s.channel)!}>@{s.channel}</ExternalLink> : s.channel} {!s.enabled && <Badge variant="outline">выключен</Badge>}</TableCell>
                <TableCell><CitySelect value={s.city_id} onChange={(city_id) => update({ channel: s.channel, city_id })} /></TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {s.host && <EntityLink entity="host" id={s.host.id}>{s.host.name}</EntityLink>}
                    <HostPicker label={s.host ? 'Сменить' : 'Указать'} hosts={hosts ?? []} picked={!!s.host} onPick={(host) => update({ channel: s.channel, host_id: host?.id ?? null })} />
                  </div>
                </TableCell>
                <TableCell>{s.events_count}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" onClick={() => update({ channel: s.channel, enabled: !s.enabled })}>{s.enabled ? 'Выключить' : 'Включить'}</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Page>
  );
}
