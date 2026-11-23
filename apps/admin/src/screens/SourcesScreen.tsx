// «Источники»: каналы и группы, откуда сборщик берёт анонсы, а из чатов города — вопросы, мастеров и вакансии (вид, kind).
// Каналы организаторов он добавляет сам; ненужный — выключить. У источника можно указать организатора — чей это канал —
// и город: его получают события, мастера и вакансии из этого источника.
import type { SourceKind } from '@yaswami/core';
import { DEFAULT_CITY_ID, SOURCE_KINDS } from '@yaswami/core';
import { useState } from 'react';
import { CitySelect } from '@/components/City';
import { EntityLink, ExternalLink } from '@/components/EntityLink';
import { HostPicker } from '@/components/HostPicker';
import { Failed, Loading, Nothing, Page } from '@/components/Page';
import { ActionsCell, ActionsHead } from '@/components/RowActions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useHosts } from '@/hooks/useHosts';
import { useSources } from '@/hooks/useSources';

// Закрытый чат задаётся id (-100…): ссылки на него нет.
const link = (channel: string) => (channel.startsWith('-') ? null : `https://t.me/${channel}`);

export const KIND_NAMES: Record<SourceKind, string> = { announcements: 'Анонсы', leads: 'Чат города', jobs: 'Чат о работе' };

/** Вид источника: анонсы; чат города — вопросы «куда сходить», мастера и вакансии; чат о работе — только вакансии. */
function KindSelect({ value, onChange }: { value: SourceKind; onChange: (kind: SourceKind) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as SourceKind)}>
      <SelectTrigger size="sm" aria-label="Вид"><SelectValue /></SelectTrigger>
      <SelectContent>{SOURCE_KINDS.map((k) => <SelectItem key={k} value={k}>{KIND_NAMES[k]}</SelectItem>)}</SelectContent>
    </Select>
  );
}

const DESCRIPTION = 'Каналы и группы, из которых сборщик берёт анонсы. Канал организатора добавляется сам, когда сборщик находит его в профиле, — по несколько за проход. Канал оказался чужим или не про события — выключите: сборщик перестанет его читать и не добавит снова. Если канал ведёт один организатор — укажите его: анонс без контакта для записи получит контактом этого организатора. Нужного нет в списке — добавьте его по username в «Организаторах». Вид «Чат города» — большой чат, где сборщик ищет вопросы «куда сходить», мастеров и вакансии; «Чат о работе» — только вакансии; анонсы из чатов не берутся. Город источника получают события, мастера и вакансии, собранные из него после этого; новый город добавляется в «Городах».';

export function SourcesScreen() {
  const { sources: { data: sources, error }, create, update } = useSources();
  const { data: hosts } = useHosts();
  const [channel, setChannel] = useState('');
  const [city, setCity] = useState<string>(DEFAULT_CITY_ID);
  const [kind, setKind] = useState<SourceKind>('announcements');
  return (
    <Page title={<>Источники <Badge>{sources?.filter((s) => s.enabled).length ?? 0}</Badge></>} description={DESCRIPTION}>
      <form className="flex max-w-xl gap-2" onSubmit={(e) => (e.preventDefault(), channel.trim() && create({ channel: channel.trim(), city_id: city, kind }, { onSuccess: () => setChannel('') }))}>
        <Input placeholder="@channel или t.me/channel" value={channel} onChange={(e) => setChannel(e.target.value)} />
        <CitySelect value={city} onChange={setCity} />
        <KindSelect value={kind} onChange={setKind} />
        <Button type="submit" variant="outline">Добавить</Button>
      </form>
      {!sources && !error && <Loading />}
      {error && <Failed error={error} />}
      {sources?.length === 0 && <Nothing title="Источников нет" />}
      {!!sources?.length && (
        <Table>
          <TableHeader>
            <TableRow><TableHead>Канал</TableHead><TableHead>Вид</TableHead><TableHead>Город</TableHead><TableHead>Организатор</TableHead><TableHead>Событий</TableHead><ActionsHead /></TableRow>
          </TableHeader>
          <TableBody>
            {sources.map((s) => (
              <TableRow key={s.channel} data-state={s.enabled ? undefined : 'disabled'}>
                <TableCell>{link(s.channel) ? <ExternalLink href={link(s.channel)!}>@{s.channel}</ExternalLink> : s.channel} {!s.enabled && <Badge variant="outline">выключен</Badge>}</TableCell>
                <TableCell><KindSelect value={s.kind} onChange={(kind) => update({ channel: s.channel, kind })} /></TableCell>
                <TableCell><CitySelect value={s.city_id} onChange={(city_id) => update({ channel: s.channel, city_id })} /></TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {s.host && <EntityLink entity="host" id={s.host.id}>{s.host.name}</EntityLink>}
                    <HostPicker label={s.host ? 'Сменить' : 'Указать'} hosts={hosts ?? []} picked={!!s.host} onPick={(host) => update({ channel: s.channel, host_id: host?.id ?? null })} />
                  </div>
                </TableCell>
                <TableCell>{s.events_count}</TableCell>
                <ActionsCell>
                  <Button size="xs" variant="outline" onClick={() => update({ channel: s.channel, enabled: !s.enabled })}>{s.enabled ? 'Выключить' : 'Включить'}</Button>
                </ActionsCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Page>
  );
}
