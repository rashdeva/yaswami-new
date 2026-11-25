// «Источники»: каналы и группы, откуда сборщик берёт анонсы, а из чатов города — вопросы и мастеров (вид, kind).
// Каналы организаторов он добавляет сам; ненужный — выключить. Канал, которого больше нет в Telegram, сборщик выключает сам и пишет причину. У источника можно указать организатора — чей это канал —
// и город: его получают события и мастера из этого источника. Наверху — источники, которые предложили люди: ждут решения.
import type { AdminSource, SourceKind, Wire } from '@yaswami/core';
import { DEFAULT_CITY_ID, instagramOf, SOURCE_KINDS } from '@yaswami/core';
import { useState } from 'react';
import { CitySelect } from '@/components/City';
import { Confirm } from '@/components/Confirm';
import { EntityLink, PlatformIcon, SourceLink, TelegramLink } from '@/components/EntityLink';
import { when } from '@/components/History';
import { HostPicker } from '@/components/HostPicker';
import { Failed, Hint, Loading, Nothing, Page, Section } from '@/components/Page';
import { ActionsCell, ActionsHead } from '@/components/RowActions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useHosts } from '@/hooks/useHosts';
import { useSources } from '@/hooks/useSources';

export const KIND_NAMES: Record<SourceKind, string> = { announcements: 'Анонсы', leads: 'Чат города', products: 'Товары' };

/** Вид источника: анонсы; чат города — вопросы «куда сходить» и мастера; товары — канал мастера или группа объявлений. */
function KindSelect({ value, onChange }: { value: SourceKind; onChange: (kind: SourceKind) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as SourceKind)}>
      <SelectTrigger size="sm" aria-label="Вид"><SelectValue /></SelectTrigger>
      <SelectContent>{SOURCE_KINDS.map((k) => <SelectItem key={k} value={k}>{KIND_NAMES[k]}</SelectItem>)}</SelectContent>
    </Select>
  );
}

const DESCRIPTION = 'Каналы и группы Telegram и профили Instagram, из которых сборщик берёт анонсы. Профиль Instagram добавляется ссылкой instagram.com/ник, а у организатора с указанным Instagram — сам; читается раз в несколько часов. Канал организатора добавляется сам, когда сборщик находит его в профиле, — по несколько за проход. Канал оказался чужим или не про события — выключите: сборщик перестанет его читать и не добавит снова. Если канал ведёт один организатор — укажите его: анонс без контакта для записи получит контактом этого организатора. Нужного нет в списке — добавьте его по username в «Организаторах». Вид «Чат города» — большой чат, где сборщик ищет вопросы «куда сходить» и мастеров; анонсы из чатов не берутся. Город источника получают события и мастера, собранные из него после этого; новый город добавляется в «Городах».';

type Update = ReturnType<typeof useSources>['update'];
const platform = (channel: string) => (
  <span className="inline-flex items-center gap-1"><PlatformIcon instagram={!!instagramOf(channel)} />{instagramOf(channel) ? 'Instagram' : 'Telegram'}</span>
);

/**
 * Источники, которые предложили люди (кнопка внизу «Всех событий» или просьба боту): пока решения нет, источник
 * выключен. Одобрить — включить и поблагодарить человека в боте (не отменить); отклонить — оставить выключенным.
 */
function Submissions({ pending, update }: { pending: Wire<AdminSource>[]; update: Update }) {
  if (!pending.length) return null;
  return (
    <Section title={<>Предложили люди <Badge>{pending.length}</Badge></>} description="Сборщик не читает их, пока вы не решите. Город можно поправить до решения. Не больше трёх в сутки от человека; группы, чаты и несуществующие каналы отсеиваются сразу.">
      <Table>
        <TableHeader>
          <TableRow><TableHead>Источник</TableHead><TableHead>Площадка</TableHead><TableHead>Город</TableHead><TableHead>Кто предложил</TableHead><TableHead>Когда</TableHead><ActionsHead /></TableRow>
        </TableHeader>
        <TableBody>
          {pending.map((s) => (
            <TableRow key={s.channel}>
              <TableCell><SourceLink channel={s.channel} /></TableCell>
              <TableCell>{platform(s.channel)}</TableCell>
              <TableCell><CitySelect value={s.city_id} onChange={(city_id) => update({ channel: s.channel, city_id })} /></TableCell>
              <TableCell>
                {s.submitted_by ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <EntityLink entity="user" id={s.submitted_by.id}>{s.submitted_by.first_name}</EntityLink>
                    {s.submitted_by.username && <TelegramLink username={s.submitted_by.username} />}
                  </div>
                ) : '—'}
              </TableCell>
              <TableCell>{when(s.created_at)}</TableCell>
              <ActionsCell>
                <ButtonGroup>
                  <Confirm
                    title="Одобрить источник?"
                    description={`Сборщик начнёт его читать со следующего прохода${s.submitted_by ? `, а бот напишет ${s.submitted_by.first_name} спасибо. Сообщение не вернуть: само одобрение из журнала не отменится, выключить источник можно и потом` : ''}.`}
                    action="Одобрить" destructive={false}
                    onConfirm={() => update({ channel: s.channel, approval_status: 'approved' })}
                  >
                    <Button size="xs">Одобрить</Button>
                  </Confirm>
                  <Button size="xs" variant="outline" onClick={() => update({ channel: s.channel, approval_status: 'declined' })}>Отклонить</Button>
                </ButtonGroup>
              </ActionsCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  );
}

export function SourcesScreen() {
  const { sources: { data: all, error }, create, update } = useSources();
  const pending = all?.filter((s) => s.approval_status === 'pending_approval') ?? [];
  const sources = all?.filter((s) => s.approval_status !== 'pending_approval');
  const { data: hosts } = useHosts();
  const [channel, setChannel] = useState('');
  const [city, setCity] = useState<string>(DEFAULT_CITY_ID);
  const [kind, setKind] = useState<SourceKind>('announcements');
  return (
    <Page title={<>Источники <Badge>{sources?.filter((s) => s.enabled).length ?? 0}</Badge></>} description={DESCRIPTION}>
      <form className="flex max-w-xl gap-2" onSubmit={(e) => (e.preventDefault(), channel.trim() && create({ channel: channel.trim(), city_id: city, kind }, { onSuccess: () => setChannel('') }))}>
        <Input placeholder="@channel, t.me/channel или instagram.com/ник" value={channel} onChange={(e) => setChannel(e.target.value)} />
        <CitySelect value={city} onChange={setCity} />
        <KindSelect value={kind} onChange={setKind} />
        <Button type="submit" variant="outline">Добавить</Button>
      </form>
      <Submissions pending={pending} update={update} />
      {!sources && !error && <Loading />}
      {error && <Failed error={error} />}
      {sources?.length === 0 && <Nothing title="Источников нет" />}
      {!!sources?.length && (
        <Table>
          <TableHeader>
            <TableRow><TableHead>Источник</TableHead><TableHead>Площадка</TableHead><TableHead>Вид</TableHead><TableHead>Город</TableHead><TableHead>Организатор</TableHead><TableHead>Событий</TableHead><ActionsHead /></TableRow>
          </TableHeader>
          <TableBody>
            {sources.map((s) => (
              <TableRow key={s.channel} data-state={s.enabled ? undefined : 'disabled'}>
                <TableCell><SourceLink channel={s.channel} /> {!s.enabled && <Badge variant="outline" title={s.disabled_reason ?? undefined}>{s.approval_status === 'declined' ? 'отклонён' : s.disabled_reason ? 'выключен сборщиком' : 'выключен'}</Badge>}
                  {s.disabled_reason && <div className="text-xs text-muted-foreground">{s.disabled_reason}</div>}
                  {s.submitted_by && <Hint>предложил(а) <EntityLink entity="user" id={s.submitted_by.id}>{s.submitted_by.first_name}</EntityLink></Hint>}</TableCell>
                <TableCell>{platform(s.channel)}</TableCell>
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
