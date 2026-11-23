// «Темы»: по ним события раскладывает сборщик, люди фильтруют ленту и подписываются. Тему добавляют команда, агент
// через MCP или сборщик сам — по меткам, которые копятся у событий без темы. Ненужную — выключить.
import type { AdminTopic, TopicCandidate, Wire } from '@yaswami/core';
import { TopicCreateInput } from '@yaswami/core';
import { useState } from 'react';
import { Failed, Loading, Page } from '@/components/Page';
import { ActionsCell, ActionsHead } from '@/components/RowActions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useTopics } from '@/hooks/useTopics';

const DESCRIPTION = 'Темы, по которым раскладываются события и услуги. Новая тема сразу появляется в фильтрах и подписках, сборщик начинает относить к ней анонсы, а события без темы с её метками переходят в неё. Иконку рисует иллюстратор за несколько минут; свою можно загрузить. Список тем — это и то, что мы публикуем: событие без темы в ленту не попадает. Сборщик добавляет темы сам, когда метка встречается у нескольких организаторов, — такие помечены «сборщик». Лишнюю тему выключите: события сохранят её имя, и её можно включить обратно.';
const ORIGIN = { built_in: null, team: 'команда', collector: 'сборщик' } as const;
const EMPTY = { name: '', slug: '', emoji: '', color: '#64748b', what: '', why: '', first: '', not_for: '', tags: '', split_from: '' };
type Draft = typeof EMPTY;
const GUIDE: [keyof Draft, string][] = [
  ['what', 'Что это: что происходит на таком событии'],
  ['why', 'Зачем приходят (без обещаний эффекта)'],
  ['first', 'Первый раз: что взять, что нормально'],
  ['not_for', 'Кому быть осторожнее'],
];
const tagsOf = (text: string) => text.split(',').map((t) => t.trim()).filter(Boolean);
const dataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

export function TopicsScreen() {
  const { topics: { data: topics, error }, candidates: { data: candidates }, create, update } = useTopics();
  // `editing` — имя темы, которую правим; null — форма добавляет новую.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [invalid, setInvalid] = useState<string | null>(null);
  const set = (key: keyof Draft) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [key]: e.target.value }));
  const reset = () => (setEditing(null), setDraft(EMPTY), setInvalid(null));
  const edit = (t: Wire<AdminTopic>) => (setEditing(t.name), setInvalid(null), setDraft({ name: t.name, slug: t.slug, emoji: t.emoji, color: t.color, what: t.what, why: t.why, first: t.first, not_for: t.not_for, tags: t.tags.join(', '), split_from: '' }));
  const propose = (c: TopicCandidate) => (setEditing(null), setInvalid(null), setDraft({ ...EMPTY, name: c.tag, tags: c.tag, split_from: c.inside ?? '' }));
  const submit = () => {
    const parsed = TopicCreateInput.safeParse({ ...draft, tags: tagsOf(draft.tags), split_from: draft.split_from || undefined });
    if (!parsed.success) return setInvalid(`Проверьте поле «${String(parsed.error.issues[0]!.path[0])}»: имя — по-русски, slug — латиницей (banya), цвет — #rrggbb, тексты гида — до 400 знаков.`);
    const { name, slug, split_from, ...rest } = parsed.data;
    if (editing) update({ name: editing, ...rest }, { onSuccess: reset });
    else create(parsed.data, { onSuccess: reset });
  };

  return (
    <Page title={<>Темы <Badge>{topics?.filter((t) => t.enabled).length ?? 0}</Badge></>} description={DESCRIPTION}>
      {!!candidates?.length && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Метки, из которых может выйти тема:</span>
          {candidates.map((c) => (
            <span key={`${c.tag}|${c.inside}`} title={c.examples.join(' · ')}>
              <Button size="xs" variant="outline" onClick={() => propose(c)}>{c.tag}{c.inside && ` (в «${c.inside}»)`} · {c.events_count} соб. · {c.hosts_count} орг.</Button>
            </span>
          ))}
        </div>
      )}
      <form className="grid max-w-3xl gap-2" onSubmit={(e) => (e.preventDefault(), submit())}>
        <div className="flex flex-wrap gap-2">
          <Input className="w-56" placeholder="Имя: настольные игры" value={draft.name} onChange={set('name')} disabled={!!editing} />
          <Input className="w-36" placeholder="slug: games" value={draft.slug} onChange={set('slug')} disabled={!!editing} />
          <Input className="w-20" placeholder="🎲" value={draft.emoji} onChange={set('emoji')} />
          <Input className="w-16 p-1" type="color" aria-label="Цвет темы" value={draft.color} onChange={set('color')} />
        </div>
        {GUIDE.map(([key, label]) => <Textarea key={key} rows={2} placeholder={label} value={draft[key]} onChange={set(key)} />)}
        <Input placeholder="Метки через запятую: цигун, тайцзи — события без темы с ними перейдут сюда" value={draft.tags} onChange={set('tags')} />
        {draft.split_from && !editing && <p className="text-muted-foreground text-sm">Выделяется из темы «{draft.split_from}»: её события с этими метками перейдут в новую, а подписанные на «{draft.split_from}» получат и её.</p>}
        {invalid && <p className="text-destructive text-sm" role="alert">{invalid}</p>}
        <div className="flex gap-2">
          <Button type="submit" variant="outline">{editing ? `Сохранить «${editing}»` : 'Добавить тему'}</Button>
          {(editing || draft !== EMPTY) && <Button type="button" variant="ghost" onClick={reset}>Отмена</Button>}
        </div>
      </form>
      {!topics && !error && <Loading />}
      {error && <Failed error={error} />}
      {!!topics?.length && (
        <Table>
          <TableHeader>
            <TableRow><TableHead>Тема</TableHead><TableHead>Гид</TableHead><TableHead>Метки</TableHead><TableHead>Событий</TableHead><ActionsHead /></TableRow>
          </TableHeader>
          <TableBody>
            {topics.map((t) => (
              <TableRow key={t.name} data-state={t.enabled ? undefined : 'disabled'}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {t.has_icon
                      ? <img src={t.icon_url ?? `/topics/${t.slug}.png`} alt="" className="size-8" />
                      : <span className="grid size-8 place-items-center rounded-md text-lg" style={{ background: `${t.color}22` }} title="Иконку ещё рисуют">{t.emoji}</span>}
                    <span className="font-medium" style={{ color: t.color }}>{t.name}</span>
                    {ORIGIN[t.origin] && <Badge variant="outline">{ORIGIN[t.origin]}</Badge>}
                    {!t.enabled && <Badge variant="outline">выключена</Badge>}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground max-w-md truncate" title={[t.what, t.why, t.first, t.not_for].join('\n\n')}>{t.what}</TableCell>
                <TableCell className="max-w-48 truncate" title={t.tags.join(', ')}>{t.tags.join(', ')}</TableCell>
                <TableCell>{t.events_count}</TableCell>
                <ActionsCell>
                  <Button size="xs" variant="outline" onClick={() => edit(t)}>Править</Button>
                  <Button size="xs" variant="outline" asChild>
                    <label>
                      Иконка
                      <input type="file" accept="image/png,image/jpeg" hidden onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file) void dataUrl(file).then((icon_url) => update({ name: t.name, icon_url }));
                      }} />
                    </label>
                  </Button>
                  <Button size="xs" variant="outline" onClick={() => update({ name: t.name, enabled: !t.enabled })}>{t.enabled ? 'Выключить' : 'Включить'}</Button>
                </ActionsCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Page>
  );
}
