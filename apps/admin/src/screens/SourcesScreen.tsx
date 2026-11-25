// «Источники» по календарям: календарь (Calendar, как в Luma) — вывеска площадки, сообщества, организатора или афиши,
// в нём её Telegram-канал и Instagram-профиль. Каналы организаторов сборщик добавляет сам; ненужный — выключить.
// Канал, которого больше нет в Telegram, сборщик выключает сам и пишет причину. Telegram и Instagram одной вывески
// склеиваются переносом источника в один календарь; у календаря — имя, вид и организатор, у источника — вид и город.
import type { AdminCalendar, CalendarKind, SourceKind, Wire } from '@yaswami/core';
import { CALENDAR_KINDS, DEFAULT_CITY_ID, instagramOf, SOURCE_KINDS } from '@yaswami/core';
import { Fragment, useState } from 'react';
import { CalendarPicker } from '@/components/CalendarPicker';
import { CitySelect } from '@/components/City';
import { EntityLink, PlatformIcon, SourceLink } from '@/components/EntityLink';
import { HostPicker } from '@/components/HostPicker';
import { Failed, Loading, Nothing, Page } from '@/components/Page';
import { ActionsCell, ActionsHead } from '@/components/RowActions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useHosts } from '@/hooks/useHosts';
import { useSources } from '@/hooks/useSources';

export const KIND_NAMES: Record<SourceKind, string> = { announcements: 'Анонсы', leads: 'Чат города', jobs: 'Чат о работе' };
const CALENDAR_KIND_NAMES: Record<CalendarKind, string> = { host: 'Организатор', venue: 'Площадка', community: 'Сообщество', listing: 'Афиша' };
const NO_KIND = 'none';

/** Вид источника: анонсы; чат города — вопросы «куда сходить», мастера и вакансии; чат о работе — только вакансии. */
function KindSelect({ value, onChange }: { value: SourceKind; onChange: (kind: SourceKind) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as SourceKind)}>
      <SelectTrigger size="sm" aria-label="Вид"><SelectValue /></SelectTrigger>
      <SelectContent>{SOURCE_KINDS.map((k) => <SelectItem key={k} value={k}>{KIND_NAMES[k]}</SelectItem>)}</SelectContent>
    </Select>
  );
}

/** Вид календаря; подсказка по событиям — значком рядом, если вид не указан или указан другой. */
function CalendarKindSelect({ calendar, onChange }: { calendar: Wire<AdminCalendar>; onChange: (kind: CalendarKind | null) => void }) {
  const hint = calendar.suggested_kind && calendar.suggested_kind !== calendar.kind ? calendar.suggested_kind : null;
  return (
    <div className="flex items-center gap-2">
      <Select value={calendar.kind ?? NO_KIND} onValueChange={(v) => onChange(v === NO_KIND ? null : (v as CalendarKind))}>
        <SelectTrigger size="sm" aria-label="Вид календаря"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_KIND}>Вид не указан</SelectItem>
          {CALENDAR_KINDS.map((k) => <SelectItem key={k} value={k}>{CALENDAR_KIND_NAMES[k]}</SelectItem>)}
        </SelectContent>
      </Select>
      {hint && (
        <Button size="xs" variant="ghost" title="Подсказка по собранным событиям за 90 дней: сколько разных контактов и тем" onClick={() => onChange(hint)}>
          похоже: {CALENDAR_KIND_NAMES[hint]}
        </Button>
      )}
    </div>
  );
}

/** Переименовать календарь: имя вывески, по умолчанию — канал. */
function RenameButton({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(name);
  return (
    <Popover open={open} onOpenChange={(o) => (setOpen(o), setValue(name))}>
      <PopoverTrigger asChild><Button size="xs" variant="outline">Переименовать</Button></PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), value.trim() && (onRename(value.trim()), setOpen(false)))}>
          <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} aria-label="Имя календаря" />
          <Button type="submit" size="sm">Сохранить</Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

const DESCRIPTION = 'Источники собраны в календари, как в Luma: календарь — вывеска площадки, сообщества, организатора или афиши, в нём её Telegram-канал и Instagram-профиль. Новый источник получает свой календарь; если это другая площадка той же вывески — «Перенести» его в её календарь. Вид календаря подсказывают события: один контакт для записи — организатор, много разных контактов и тем — афиша. Укажите организатора календаря, если вывеску ведёт он: анонс без контакта из любого её источника получит контактом этого организатора; нужного нет в списке — добавьте его по username в «Организаторах». Профиль Instagram добавляется ссылкой instagram.com/ник, а у организатора с указанным Instagram — сам; читается раз в несколько часов. Канал оказался чужим или не про события — выключите: сборщик перестанет его читать и не добавит снова. Вид источника «Чат города» — большой чат, где сборщик ищет вопросы «куда сходить», мастеров и вакансии; «Чат о работе» — только вакансии. Город источника получают события, мастера и вакансии, собранные из него после этого.';

export function SourcesScreen() {
  const { calendars: { data: calendars, error }, create, update, updateCalendar } = useSources();
  const { data: hosts } = useHosts();
  const [channel, setChannel] = useState('');
  const [city, setCity] = useState<string>(DEFAULT_CITY_ID);
  const [kind, setKind] = useState<SourceKind>('announcements');
  const enabled = calendars?.flatMap((c) => c.sources).filter((s) => s.enabled).length ?? 0;
  return (
    <Page title={<>Источники <Badge>{enabled}</Badge></>} description={DESCRIPTION}>
      <form className="flex max-w-xl gap-2" onSubmit={(e) => (e.preventDefault(), channel.trim() && create({ channel: channel.trim(), city_id: city, kind }, { onSuccess: () => setChannel('') }))}>
        <Input placeholder="@channel, t.me/channel или instagram.com/ник" value={channel} onChange={(e) => setChannel(e.target.value)} />
        <CitySelect value={city} onChange={setCity} />
        <KindSelect value={kind} onChange={setKind} />
        <Button type="submit" variant="outline">Добавить</Button>
      </form>
      {!calendars && !error && <Loading />}
      {error && <Failed error={error} />}
      {calendars?.length === 0 && <Nothing title="Источников нет" />}
      {!!calendars?.length && (
        <Table>
          <TableHeader>
            <TableRow><TableHead>Календарь и источники</TableHead><TableHead>Вид</TableHead><TableHead>Город</TableHead><TableHead>Организатор</TableHead><TableHead>Событий</TableHead><ActionsHead /></TableRow>
          </TableHeader>
          <TableBody>
            {calendars.map((c) => (
              <Fragment key={c.id}>
                <TableRow>
                  <TableCell>{c.name}</TableCell>
                  <TableCell><CalendarKindSelect calendar={c} onChange={(kind) => updateCalendar({ id: c.id, kind })} /></TableCell>
                  <TableCell />
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {c.host && <EntityLink entity="host" id={c.host.id}>{c.host.name}</EntityLink>}
                      <HostPicker label={c.host ? 'Сменить' : 'Указать'} hosts={hosts ?? []} picked={!!c.host} onPick={(host) => updateCalendar({ id: c.id, host_id: host?.id ?? null })} />
                    </div>
                  </TableCell>
                  <TableCell>{c.sources.reduce((n, s) => n + s.events_count, 0)}</TableCell>
                  <ActionsCell><RenameButton name={c.name} onRename={(name) => updateCalendar({ id: c.id, name })} /></ActionsCell>
                </TableRow>
                {c.sources.map((s) => (
                  <TableRow key={s.channel} data-state={s.enabled ? undefined : 'disabled'}>
                    <TableCell className="pl-8">
                      <span className="inline-flex items-center gap-2"><SourceLink channel={s.channel} />
                        <Badge variant="outline"><PlatformIcon instagram={!!instagramOf(s.channel)} />{instagramOf(s.channel) ? 'Instagram' : 'Telegram'}</Badge>
                        {!s.enabled && <Badge variant="outline" title={s.disabled_reason ?? undefined}>{s.disabled_reason ? 'выключен сборщиком' : 'выключен'}</Badge>}</span>
                      {s.disabled_reason && <div className="text-xs text-muted-foreground">{s.disabled_reason}</div>}
                    </TableCell>
                    <TableCell><KindSelect value={s.kind} onChange={(kind) => update({ channel: s.channel, kind })} /></TableCell>
                    <TableCell><CitySelect value={s.city_id} onChange={(city_id) => update({ channel: s.channel, city_id })} /></TableCell>
                    <TableCell />
                    <TableCell>{s.events_count}</TableCell>
                    <ActionsCell>
                      <ButtonGroup>
                        <CalendarPicker calendars={calendars} current={c.id} canSplit={c.sources.length > 1} onPick={(calendar_id) => update({ channel: s.channel, calendar_id })} />
                        <Button size="xs" variant="outline" onClick={() => update({ channel: s.channel, enabled: !s.enabled })}>{s.enabled ? 'Выключить' : 'Включить'}</Button>
                      </ButtonGroup>
                    </ActionsCell>
                  </TableRow>
                ))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      )}
    </Page>
  );
}
