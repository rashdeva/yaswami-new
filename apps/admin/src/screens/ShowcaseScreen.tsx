// «Витрина» (ADR-0009): полки главной города. Полки собирают команда и куратор (роль agents/curator); здесь видно,
// кто что собрал, полки переставляются, закрепляются (куратор их не тронет), публикуются из предложенных, снимаются.
import type { AdminShelf, ShelfPeriod, ShelfRule, Wire } from '@yaswami/core';
import { DEFAULT_SHELVES, MIN_SHELF_EVENTS, SHELF_PERIODS, ShelfCreateInput } from '@yaswami/core';
import { ArrowDownIcon, ArrowUpIcon, PinIcon } from 'lucide-react';
import { useState } from 'react';
import { CitySelect } from '@/components/City';
import { Confirm, UNDO_HINT } from '@/components/Confirm';
import { Failed, Loading, Nothing, Page, Section } from '@/components/Page';
import { ActionsCell, ActionsHead } from '@/components/RowActions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useCities } from '@/hooks/useCities';
import { useShelves } from '@/hooks/useShelves';
import { useTopicList } from '@/hooks/useTopics';
import { AUTHORS, PERIODS, STATUSES, shelfHow } from '@/lib/shelves';

const DESCRIPTION = `Главная мини-приложения: полки сверху вниз, под ними все события по дням. Полку по правилу события наполняют сами; ручную собирает автор. Полку, где меньше ${MIN_SHELF_EVENTS} событий, гость не видит. Куратор (ИИ) меняет только свои незакреплённые полки; ваша правка закрепляет полку. В режиме «Черновик» полки куратора ждут «Опубликовать».`;
const NO_TOPIC = '—';
const ANY = 'any';

interface Draft {
  title: string;
  topic: string;
  kind: 'rule' | 'manual';
  period: ShelfPeriod | typeof ANY;
  ruleTopic: string;
  free: boolean;
  beginner: boolean;
  popular: boolean;
  event_ids: string[];
  note: string;
}
const EMPTY: Draft = { title: '', topic: NO_TOPIC, kind: 'rule', period: 'week', ruleTopic: NO_TOPIC, free: false, beginner: false, popular: false, event_ids: [], note: '' };

const ruleOf = (d: Draft): ShelfRule => ({
  ...(d.period !== ANY && { period: d.period }), ...(d.ruleTopic !== NO_TOPIC && { topic: d.ruleTopic }),
  ...(d.free && { free: true }), ...(d.beginner && { beginner_friendly: true }), ...(d.popular && { popular: true }),
});
const draftOf = (s: Wire<AdminShelf>): Draft => ({
  title: s.title, topic: s.topic ?? NO_TOPIC, kind: s.rule ? 'rule' : 'manual', period: s.rule?.period ?? ANY, ruleTopic: s.rule?.topic ?? NO_TOPIC,
  free: !!s.rule?.free, beginner: !!s.rule?.beginner_friendly, popular: !!s.rule?.popular, event_ids: s.event_ids, note: s.note ?? '',
});

export function ShowcaseScreen({ city, onCity }: { city: string; onCity: (city: string) => void }) {
  const { shelves: { data: shelves, error }, events: { data: events }, create, update, remove, move } = useShelves(city);
  const { cities: { data: cities }, update: updateCity } = useCities();
  const topics = (useTopicList().data ?? []).filter((t) => t.enabled);
  const mode = cities?.find((c) => c.id === city)?.showcase_mode ?? 'draft';
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [invalid, setInvalid] = useState<string | null>(null);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const reset = () => (setEditing(null), setDraft(EMPTY), setInvalid(null));
  const iconOf = (name: string | null) => {
    const t = topics.find((x) => x.name === name);
    return t && (t.icon_url ?? `/topics/${t.slug}.png`);
  };

  const submit = () => {
    const body = {
      title: draft.title, topic: draft.topic === NO_TOPIC ? null : draft.topic, note: draft.note.trim() || null,
      ...(draft.kind === 'rule' ? { rule: ruleOf(draft) } : { rule: null, event_ids: draft.event_ids }),
    };
    const parsed = ShelfCreateInput.safeParse({ city_id: city, ...body });
    if (!parsed.success) return setInvalid('Проверьте название (до 60 знаков) и события: у ручной полки — хотя бы одно, не больше 20.');
    if (draft.kind === 'manual' && !draft.event_ids.length) return setInvalid('Отметьте события ручной полки.');
    if (editing) update({ id: editing, ...body }, { onSuccess: reset });
    else create(parsed.data, { onSuccess: reset });
  };

  return (
    <Page
      title="Витрина"
      description={DESCRIPTION}
      actions={(
        <div className="flex flex-wrap items-center gap-2">
          <CitySelect value={city} onChange={onCity} />
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
        <Nothing title="Своих полок у города нет" hint={`Гость видит полки по умолчанию: ${DEFAULT_SHELVES.map((s) => `«${s.title}»`).join(', ')}. Первая своя полка их заменит.`} />
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
                      <span className="truncate font-medium">{s.title}{s.pinned && <PinIcon className="ml-1 inline size-3" aria-label="Закреплена" />}</span>
                      {s.note && <span className="text-muted-foreground truncate text-xs" title={s.note}>{s.note}</span>}
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
                    <Button size="xs" variant="outline" onClick={() => (setEditing(s.id), setInvalid(null), setDraft(draftOf(s)))}>Править</Button>
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

      <Section title={editing ? 'Править полку' : 'Новая полка'} description="Правило подбирает события само при каждом показе; ручную полку собираете вы.">
        <form className="grid max-w-3xl gap-3" onSubmit={(e) => (e.preventDefault(), submit())}>
          <div className="flex flex-wrap gap-2">
            <Input className="w-72" placeholder="Название: Баня недели" value={draft.title} onChange={(e) => set('title', e.target.value)} />
            <Select value={draft.topic} onValueChange={(v) => set('topic', v)}>
              <SelectTrigger className="w-56" aria-label="Обложка — иконка темы"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TOPIC}>Без обложки</SelectItem>
                {topics.map((t) => <SelectItem key={t.name} value={t.name}>{t.emoji} {t.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <ToggleGroup type="single" variant="outline" value={draft.kind} onValueChange={(v) => v && set('kind', v as Draft['kind'])}>
              <ToggleGroupItem value="rule">По правилу</ToggleGroupItem>
              <ToggleGroupItem value="manual">Вручную</ToggleGroupItem>
            </ToggleGroup>
          </div>
          {draft.kind === 'rule' ? (
            <div className="flex flex-wrap items-center gap-4">
              <Select value={draft.period} onValueChange={(v) => set('period', v as Draft['period'])}>
                <SelectTrigger className="w-44" aria-label="Когда"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>все предстоящие</SelectItem>
                  {SHELF_PERIODS.map((p) => <SelectItem key={p} value={p}>{PERIODS[p]}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={draft.ruleTopic} onValueChange={(v) => set('ruleTopic', v)}>
                <SelectTrigger className="w-48" aria-label="Тема событий"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TOPIC}>любая тема</SelectItem>
                  {topics.map((t) => <SelectItem key={t.name} value={t.name}>{t.emoji} {t.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {([['free', 'Бесплатно'], ['beginner', 'Без опыта'], ['popular', 'Популярное']] as const).map(([key, label]) => (
                <Label key={key} className="flex items-center gap-2"><Switch checked={draft[key]} onCheckedChange={(v) => set(key, v)} />{label}</Label>
              ))}
            </div>
          ) : (
            <div className="grid max-h-72 gap-1 overflow-y-auto">
              {(events ?? []).map((e) => (
                <Label key={e.id} className="flex items-center gap-2">
                  <Switch
                    checked={draft.event_ids.includes(e.id)}
                    onCheckedChange={(on) => set('event_ids', on ? [...draft.event_ids, e.id] : draft.event_ids.filter((x) => x !== e.id))}
                  />
                  <span className="truncate">{e.starts_at.slice(0, 16).replace('T', ' ')} · {e.title}</span>
                </Label>
              ))}
              {events?.length === 0 && <Nothing title="Предстоящих событий в городе нет" />}
            </div>
          )}
          <Textarea rows={2} placeholder="Заметка для команды: почему полка такая" value={draft.note} onChange={(e) => set('note', e.target.value)} />
          {invalid && <p className="text-destructive text-sm" role="alert">{invalid}</p>}
          <div className="flex gap-2">
            <Button type="submit" variant="outline">{editing ? 'Сохранить' : 'Добавить полку'}</Button>
            {(editing || draft !== EMPTY) && <Button type="button" variant="ghost" onClick={reset}>Отмена</Button>}
          </div>
        </form>
      </Section>
    </Page>
  );
}
