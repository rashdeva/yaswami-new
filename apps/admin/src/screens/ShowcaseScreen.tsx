// «Витрина» (ADR-0009): полки главной города. Полки собирают команда и куратор (роль agents/curator); здесь видно,
// кто что собрал, полки переставляются, закрепляются (куратор их не тронет), публикуются из предложенных, снимаются.
import { zodResolver } from '@hookform/resolvers/zod';
import type { AdminShelf, CollectedEventItem, ShelfRule, Wire } from '@yaswami/core';
import { DEFAULT_SHELVES, MIN_SHELF_EVENTS, SHELF_PERIODS, ShelfCreateInput, ShelfUpdateInput } from '@yaswami/core';
import { ArrowDownIcon, ArrowUpIcon, PinIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { CitySelect } from '@/components/City';
import { Confirm, UNDO_HINT } from '@/components/Confirm';
import type { Form } from '@/components/Fields';
import { AreaField, SaveBar, SelectField, Shell, TextField, saveDirty, showIssues } from '@/components/Fields';
import { Failed, Hint, Loading, Nothing, Page, Section } from '@/components/Page';
import { ActionsCell, ActionsHead } from '@/components/RowActions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { FieldGroup, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useCities } from '@/hooks/useCities';
import { useShelves } from '@/hooks/useShelves';
import { useTopicList } from '@/hooks/useTopics';
import { AUTHORS, PERIODS, STATUSES, shelfHow } from '@/lib/shelves';

const DESCRIPTION = `Главная мини-приложения: полки сверху вниз, под ними все события по дням. Полку по правилу события наполняют сами; ручную собирает автор. Полку, где меньше ${MIN_SHELF_EVENTS} событий, гость не видит; если показать нечего — гость видит полки по умолчанию. Куратор (ИИ) меняет только свои незакреплённые полки и не встаёт выше полок команды; ваша правка содержимого закрепляет полку. В режиме «Черновик» полки куратора ждут «Опубликовать».`;
const ANY = 'any';

type Topic = { name: string; emoji: string };
const valuesOf = (s: Wire<AdminShelf>): ShelfUpdateInput => ({ title: s.title, topic: s.topic, rule: s.rule, event_ids: s.event_ids, note: s.note });
const EMPTY = (city_id: string): ShelfCreateInput => ({ city_id, title: '', topic: null, rule: { period: 'week' }, event_ids: [], note: null });

/** Правило полки: период, тема и флаги; пустые поля в правило не попадают. */
function RuleInput({ value, onChange, topics }: { value: ShelfRule; onChange: (rule: ShelfRule) => void; topics: Topic[] }) {
  const set = (patch: Partial<Record<keyof ShelfRule, unknown>>) =>
    onChange(Object.fromEntries(Object.entries({ ...value, ...patch }).filter(([, v]) => v !== undefined && v !== false)) as ShelfRule);
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Select value={value.period ?? ANY} onValueChange={(v) => set({ period: v === ANY ? undefined : v })}>
        <SelectTrigger className="w-44" aria-label="Когда"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>все предстоящие</SelectItem>
          {SHELF_PERIODS.map((p) => <SelectItem key={p} value={p}>{PERIODS[p]}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={value.topic ?? ANY} onValueChange={(v) => set({ topic: v === ANY ? undefined : v })}>
        <SelectTrigger className="w-48" aria-label="Тема событий"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>любая тема</SelectItem>
          {topics.map((t) => <SelectItem key={t.name} value={t.name}>{t.emoji} {t.name}</SelectItem>)}
        </SelectContent>
      </Select>
      {([['free', 'Бесплатно'], ['beginner_friendly', 'Без опыта'], ['popular', 'Популярное']] as const).map(([key, label]) => (
        <FieldLabel key={key} className="flex items-center gap-2"><Switch checked={!!value[key]} onCheckedChange={(on) => set({ [key]: on })} />{label}</FieldLabel>
      ))}
    </div>
  );
}

/** События ручной полки — из предстоящих событий города; уже стоящие на полке прошедшие не показываем, но и не теряем. */
function EventsInput({ value, onChange, events }: { value: string[]; onChange: (ids: string[]) => void; events: Wire<CollectedEventItem>[] }) {
  if (!events.length) return <Hint>Предстоящих событий в городе нет.</Hint>;
  return (
    <div className="grid max-h-72 gap-1 overflow-y-auto">
      {events.map((e) => (
        <FieldLabel key={e.id} className="flex items-center gap-2">
          <Switch checked={value.includes(e.id)} onCheckedChange={(on) => onChange(on ? [...value, e.id] : value.filter((x) => x !== e.id))} />
          <span className="truncate">{e.starts_at.slice(0, 16).replace('T', ' ')} · {e.title}</span>
        </FieldLabel>
      ))}
    </div>
  );
}

/** Поля полки — общие для новой и правки: правило или события, обложка, заметка. */
function ShelfFields({ form: f, onRule, topics, events }: { form: Form; onRule: (rule: ShelfRule | null) => void; topics: Topic[]; events: Wire<CollectedEventItem>[] }) {
  const rule = f.watch('rule') as ShelfRule | null | undefined;
  return (
    <FieldGroup>
      <div className="grid gap-4 md:grid-cols-2">
        <TextField form={f} name="title" label="Название" placeholder="Баня недели" />
        <SelectField form={f} name="topic" label="Обложка — иконка темы" nullable options={topics.map((t) => [t.name, `${t.emoji} ${t.name}`] as const)} />
      </div>
      <ToggleGroup type="single" variant="outline" value={rule ? 'rule' : 'manual'} onValueChange={(v) => v && onRule(v === 'rule' ? { period: 'week' } : null)}>
        <ToggleGroupItem value="rule">По правилу</ToggleGroupItem>
        <ToggleGroupItem value="manual">Вручную</ToggleGroupItem>
      </ToggleGroup>
      {rule
        ? <Shell form={f} name="rule" label="Какие события">{(field) => <RuleInput value={(field.value as ShelfRule) ?? {}} onChange={field.onChange} topics={topics} />}</Shell>
        : <Shell form={f} name="event_ids" label="События полки">{(field) => <EventsInput value={(field.value as string[]) ?? []} onChange={field.onChange} events={events} />}</Shell>}
      <AreaField form={f} name="note" label="Заметка для команды" nullable rows={2} />
    </FieldGroup>
  );
}

/** Правка полки: уходят только изменённые поля — заголовок правится, не трогая события полки. */
function EditShelf({ shelf, topics, events, onDone }: { shelf: Wire<AdminShelf>; topics: Topic[]; events: Wire<CollectedEventItem>[]; onDone: () => void }) {
  const { update } = useShelves(shelf.city_id);
  const values = useMemo(() => valuesOf(shelf), [shelf]);
  const form = useForm({ resolver: zodResolver(ShelfUpdateInput), values, resetOptions: { keepDirtyValues: true } });
  return (
    <Section title={`Править «${shelf.title}»`} actions={<Button variant="ghost" onClick={onDone}>Закрыть</Button>}>
      <form onSubmit={saveDirty(form, (input: ShelfUpdateInput, cb) => update({ id: shelf.id, ...input }, cb))} className="flex max-w-3xl flex-col gap-4">
        <ShelfFields form={form} onRule={(rule) => form.setValue('rule', rule, { shouldDirty: true })} topics={topics} events={events} />
        <SaveBar form={form} />
      </form>
    </Section>
  );
}

function NewShelf({ city, topics, events }: { city: string; topics: Topic[]; events: Wire<CollectedEventItem>[] }) {
  const { create } = useShelves(city);
  const form = useForm({ resolver: zodResolver(ShelfCreateInput), defaultValues: EMPTY(city) });
  const submit = form.handleSubmit((input) => create(input.rule ? { ...input, event_ids: [] } : input, { onSuccess: () => form.reset(EMPTY(city)), onError: (e) => showIssues(form, e) }));
  return (
    <Section title="Новая полка" description="Правило подбирает события само при каждом показе; ручную полку собираете вы.">
      <form onSubmit={submit} className="flex max-w-3xl flex-col gap-4">
        <ShelfFields form={form} onRule={(rule) => form.setValue('rule', rule, { shouldDirty: true })} topics={topics} events={events} />
        <div><Button type="submit">Добавить полку</Button></div>
      </form>
    </Section>
  );
}

export function ShowcaseScreen({ city, onCity }: { city: string; onCity: (city: string) => void }) {
  const { shelves: { data: shelves, error }, events: { data: events = [] }, update, remove, move } = useShelves(city);
  const { cities: { data: cities }, update: updateCity } = useCities();
  const topics = (useTopicList().data ?? []).filter((t) => t.enabled);
  const mode = cities?.find((c) => c.id === city)?.showcase_mode ?? 'draft';
  const [editing, setEditing] = useState<string | null>(null);
  const edited = shelves?.find((s) => s.id === editing);
  const iconOf = (name: string | null) => {
    const t = topics.find((x) => x.name === name);
    return t && (t.icon_url ?? `/topics/${t.slug}.png`);
  };

  return (
    <Page
      title="Витрина"
      description={DESCRIPTION}
      actions={(
        <div className="flex flex-wrap items-center gap-2">
          <CitySelect value={city} onChange={(next) => (setEditing(null), onCity(next))} />
          <ToggleGroup type="single" variant="outline" size="sm" value={mode} onValueChange={(v) => v && updateCity({ id: city, showcase_mode: v as 'draft' | 'auto' })}>
            <ToggleGroupItem value="draft">Черновик</ToggleGroupItem>
            <ToggleGroupItem value="auto">ИИ публикует сам</ToggleGroupItem>
          </ToggleGroup>
        </div>
      )}
    >
      {!shelves && !error && <Loading />}
      {error && <Failed error={error} />}
      {shelves?.length === 0 && (
        <Nothing title="Своих полок у города нет" hint={`Гость видит полки по умолчанию: ${DEFAULT_SHELVES.map((s) => `«${s.title}»`).join(', ')}. Первая своя опубликованная полка их заменит.`} />
      )}
      {!!shelves?.length && (
        <Table>
          <TableHeader>
            <TableRow><TableHead /><TableHead>Полка</TableHead><TableHead>Как собирается</TableHead><TableHead>Автор</TableHead><TableHead>Статус</TableHead><TableHead>Событий</TableHead><ActionsHead /></TableRow>
          </TableHeader>
          <TableBody>
            {shelves.map((s, i) => (
              <TableRow key={s.id} data-state={s.status === 'published' ? undefined : 'disabled'}>
                <TableCell>
                  <ButtonGroup>
                    <Button size="icon-xs" variant="ghost" aria-label="Выше" disabled={i === 0} onClick={() => move(s.id, -1)}><ArrowUpIcon /></Button>
                    <Button size="icon-xs" variant="ghost" aria-label="Ниже" disabled={i === shelves.length - 1} onClick={() => move(s.id, 1)}><ArrowDownIcon /></Button>
                  </ButtonGroup>
                </TableCell>
                <TableCell className="max-w-72">
                  <div className="flex items-center gap-2">
                    {iconOf(s.topic) && <img src={iconOf(s.topic)!} alt="" className="size-8" />}
                    <div className="grid min-w-0">
                      <span className="truncate">{s.title}{s.pinned && <PinIcon className="ml-1 inline size-3" aria-label="Закреплена" />}</span>
                      {s.note && <Hint>{s.note}</Hint>}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="max-w-56 truncate" title={s.events.map((e) => e.title).join('\n')}>{shelfHow(s)}</TableCell>
                <TableCell><Badge variant={s.author === 'curator' ? 'secondary' : 'outline'}>{AUTHORS[s.author]}</Badge></TableCell>
                <TableCell><Badge variant={s.status === 'proposed' ? 'default' : 'outline'}>{STATUSES[s.status]}</Badge></TableCell>
                <TableCell>{s.events_count < MIN_SHELF_EVENTS ? <Badge variant="destructive" title={`Гость не видит: меньше ${MIN_SHELF_EVENTS}`}>{s.events_count}</Badge> : s.events_count}</TableCell>
                <ActionsCell>
                  <ButtonGroup>
                    {s.status !== 'published'
                      ? <Button size="xs" variant="outline" onClick={() => update({ id: s.id, status: 'published' })}>Опубликовать</Button>
                      : <Button size="xs" variant="outline" onClick={() => update({ id: s.id, status: 'hidden' })}>Снять</Button>}
                    <Button size="xs" variant="outline" onClick={() => update({ id: s.id, pinned: !s.pinned })}>{s.pinned ? 'Открепить' : 'Закрепить'}</Button>
                    <Button size="xs" variant="outline" onClick={() => setEditing(s.id)}>Править</Button>
                    <Confirm title="Удалить полку?" description={`«${s.title}» уйдёт с витрины. Снять на время — «Снять». ${UNDO_HINT}`} onConfirm={() => remove(s.id)}>
                      <Button size="xs" variant="outline">Удалить</Button>
                    </Confirm>
                  </ButtonGroup>
                </ActionsCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {edited
        ? <EditShelf key={edited.id} shelf={edited} topics={topics} events={events} onDone={() => setEditing(null)} />
        : <NewShelf key={city} city={city} topics={topics} events={events} />}
    </Page>
  );
}
