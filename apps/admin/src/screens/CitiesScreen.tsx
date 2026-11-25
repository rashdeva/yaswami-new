// «Города»: к городу относятся источники, события каталога, организаторы и события Ясвами. Новый город — здесь;
// источники ему сборщик ищет сам (поиск источников), найденное, что не добавилось само, команда добавляет тут же.
import { zodResolver } from '@hookform/resolvers/zod';
import type { City, CityCreateInput as CreateInput, CityUpdateInput as UpdateInput, Wire } from '@yaswami/core';
import { CityCreateInput, CityUpdateInput, DEFAULT_CITY_ID } from '@yaswami/core';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { SourceLink } from '@/components/EntityLink';
import type { Form } from '@/components/Fields';
import { ListField, NumberField, SaveBar, saveDirty, showIssues, TextField } from '@/components/Fields';
import { Failed, Hint, Loading, Page, Section } from '@/components/Page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCities } from '@/hooks/useCities';
import { useSourceSearches } from '@/hooks/useSourceSearches';
import { KIND_NAMES } from './SourcesScreen';

const DESCRIPTION = 'Города, в которых работает сервис. Витрина, услуги и поиск города показывают и соседние города в 25 км — для этого у города нужны координаты. У источника, события каталога, организатора и события Ясвами указан город; всё, что было до городов, — Дананг. Новому городу сборщик сам ищет источники в Telegram по названию и другим написаниям, а в Instagram — по хэштегам города — в первый же проход, потом раз в месяц. Каналы и профили, где за месяц хотя бы три публикации похожи на анонс, сразу становятся источниками: их события всё равно проходят модерацию. Группы и остальное найденное — ниже у города: добавьте нужное. Город в архиве стоит на паузе: гости его не видят, сборщик не читает его источники и не ищет новые, куратор и хранитель тем его пропускают; ничего не удаляется.';
const ALIASES_HINT = 'Через запятую, как каналы пишут город латиницей или иначе: Nha Trang. По ним ищутся источники';
const STATUS: Record<string, string> = { queued: 'ждёт сборщика', running: 'ищет, несколько минут', failed: 'не получилось' };

/** Найденное последним поиском источников: что уже в источниках — отмечено, остальное можно добавить. */
function CitySources({ city }: { city: string }) {
  const { latest, busy, lastDone, request, add } = useSourceSearches(city);
  const found = lastDone?.results ?? [];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => request(undefined)}>Найти источники сейчас</Button>
        <Hint>
          {latest && STATUS[latest.status] ? `Поиск ${STATUS[latest.status]}${latest.error ? `: ${latest.error}` : ''}. ` : ''}
          {lastDone ? `Последний поиск ${new Date(lastDone.finished_at!).toLocaleDateString('ru')}: найдено ${found.length}, в источниках ${found.filter((r) => r.added).length}.` : !latest ? 'Ещё не искали: сборщик начнёт в следующий проход.' : ''}
        </Hint>
      </div>
      {!!found.length && (
        <Table>
          <TableHeader>
            <TableRow><TableHead>Источник</TableHead><TableHead>Вид</TableHead><TableHead>Участников</TableHead><TableHead>Похожи на анонс / публикаций за месяц</TableHead><TableHead /></TableRow>
          </TableHeader>
          <TableBody>
            {found.map((r) => (
              <TableRow key={r.channel} data-state={r.added ? 'disabled' : undefined}>
                <TableCell><SourceLink channel={r.channel} /> <span className="text-muted-foreground">{r.title}</span></TableCell>
                <TableCell>{KIND_NAMES[r.kind]}</TableCell>
                <TableCell>{r.members ?? '—'}</TableCell>
                <TableCell>{r.event_like} / {r.posts_30d}</TableCell>
                <TableCell className="text-right">
                  {r.added ? <Badge variant="outline">в источниках</Badge> : <Button size="xs" variant="outline" onClick={() => add({ channel: r.channel, city_id: city, kind: r.kind })}>Добавить</Button>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
const ZONE_HINT = 'IANA, например Asia/Tbilisi. В нём сборщик читает время в анонсах города';
const EMPTY: CreateInput = { id: '', name: '', timezone: '', aliases: [], latitude: null, longitude: null };
const COORDS_HINT = 'Центр города, например 5.9746 и 80.4297 (Google Maps: правый клик по карте). Города в 25 км друг от друга — соседи: витрина одного показывает события другого, а приложение находит город по геолокации';

/** Координаты города: по ним считаются соседние города. */
function Coordinates({ form }: { form: Form }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <NumberField form={form} name="latitude" label="Широта" hint={COORDS_HINT} />
      <NumberField form={form} name="longitude" label="Долгота" />
    </div>
  );
}

const ARCHIVED_HINT = 'На паузе: гости город не видят, сборщик не читает его источники и не ищет новые. Вернуть — и всё заработает как было.';

/** В архив и обратно; город по умолчанию в архив не уходит — на нём держится всё, у чего город не указан. */
function LaunchToggle({ city }: { city: Wire<City> }) {
  const { update } = useCities();
  if (city.id === DEFAULT_CITY_ID) return null;
  const archived = city.launch_status === 'archived';
  return (
    <Button size="sm" variant="outline" onClick={() => update({ id: city.id, launch_status: archived ? 'launched' : 'archived' })}>
      {archived ? 'Вернуть из архива' : 'В архив'}
    </Button>
  );
}

function CityForm({ city }: { city: Wire<City> }) {
  const { update } = useCities();
  const values = useMemo((): UpdateInput => ({ name: city.name, timezone: city.timezone, aliases: city.aliases, latitude: city.latitude, longitude: city.longitude }), [city]);
  const form = useForm({ resolver: zodResolver(CityUpdateInput), values, resetOptions: { keepDirtyValues: true } });
  if (city.launch_status === 'archived') return (
    <Section title={<>{city.name} <Badge variant="outline">в архиве</Badge></>} description={`id: ${city.id}`} actions={<LaunchToggle city={city} />}>
      <Hint>{ARCHIVED_HINT}</Hint>
    </Section>
  );
  return (
    <Section title={city.name} description={`id: ${city.id}`} actions={<LaunchToggle city={city} />}>
      <form onSubmit={saveDirty(form, (input: UpdateInput, cb) => update({ id: city.id, ...input }, cb))} className="flex flex-col gap-4">
        <FieldGroup>
          <div className="grid gap-4 md:grid-cols-2">
            <TextField form={form} name="name" label="Название" />
            <TextField form={form} name="timezone" label="Часовой пояс" hint={ZONE_HINT} />
          </div>
          <ListField form={form} name="aliases" label="Другие написания" hint={ALIASES_HINT} by="comma" />
          <Coordinates form={form} />
        </FieldGroup>
        <SaveBar form={form} />
      </form>
      <CitySources city={city.id} />
    </Section>
  );
}

export function CitiesScreen() {
  const { cities: { data: cities, error }, create } = useCities();
  const form = useForm({ resolver: zodResolver(CityCreateInput), defaultValues: EMPTY });
  const submit = form.handleSubmit((input) => create(input, { onSuccess: () => form.reset(EMPTY), onError: (e) => showIssues(form, e) }));
  return (
    <Page title={<>Города <Badge>{cities ? cities.filter((c) => c.launch_status !== 'archived').length : '…'}</Badge></>} description={DESCRIPTION}>
      {!cities && !error && <Loading />}
      {error && <Failed error={error} />}
      {/* Работающие — сверху, архив — под ними: порядок внутри — как пришёл (старейший первым). */}
      {cities && [...cities.filter((c) => c.launch_status !== 'archived'), ...cities.filter((c) => c.launch_status === 'archived')].map((c) => <CityForm key={c.id} city={c} />)}
      <Section title="Новый город">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <FieldGroup>
            <div className="grid gap-4 md:grid-cols-3">
              <TextField form={form} name="id" label="id" hint="Латиницей, например tbilisi. Потом не меняется" />
              <TextField form={form} name="name" label="Название" placeholder="Тбилиси" />
              <TextField form={form} name="timezone" label="Часовой пояс" hint={ZONE_HINT} />
            </div>
            <ListField form={form} name="aliases" label="Другие написания" hint={ALIASES_HINT} by="comma" />
            <Coordinates form={form} />
          </FieldGroup>
          <div><Button type="submit">Добавить</Button></div>
        </form>
      </Section>
    </Page>
  );
}
