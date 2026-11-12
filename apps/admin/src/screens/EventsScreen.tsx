// «События Ясвами»: все события сервиса — предстоящие, прошедшие, поиск по названию; создание от имени организатора.
import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { EntityLink, TelegramLink } from '@/components/EntityLink';
import { Failed, Hint, Loading, Nothing, Page } from '@/components/Page';
import { Search } from '@/components/Search';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { EventsWhen } from '@/hooks/useEvents';
import { useEventList } from '@/hooks/useEvents';
import { EVENT_STATUS_LABELS } from '@/lib/catalog';
import { wallParts } from '@/lib/form';

const WHEN: [EventsWhen, string][] = [['upcoming', 'Предстоящие'], ['past', 'Прошедшие'], ['all', 'Все']];

interface Props {
  query: string;
  when: EventsWhen;
  onFilter: (filter: { query: string; when: EventsWhen }) => void;
  onNew: () => void;
}

export function EventsScreen({ query, when, onFilter, onNew }: Props) {
  const [text, setText] = useState(query);
  const { data, error, isPending } = useEventList({ when, query });
  return (
    <Page title="События Ясвами" actions={<Button size="sm" onClick={onNew}><PlusIcon />Новое событие</Button>}>
      <div className="flex flex-wrap items-center gap-2">
        {/* Поиск уходит в адрес по Enter: так он не дёргает сервер на каждую букву. */}
        <form className="min-w-60 flex-1" onSubmit={(e) => (e.preventDefault(), onFilter({ query: text.trim(), when }))}>
          <Search value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text.trim() !== query && onFilter({ query: text.trim(), when })} placeholder="Часть названия — Enter" />
        </form>
        <Tabs value={when} onValueChange={(v) => onFilter({ query, when: v as typeof when })}>
          <TabsList>{WHEN.map(([key, label]) => <TabsTrigger key={key} value={key}>{label}</TabsTrigger>)}</TabsList>
        </Tabs>
      </div>
      {isPending && <Loading />}
      {error && <Failed error={error} />}
      {data?.length === 0 && <Nothing title="Событий нет" hint={query ? 'Попробуйте другую часть названия.' : 'Ни одного события под этот отбор.'} />}
      {!!data?.length && (
        <Table>
          <TableHeader>
            <TableRow><TableHead>Событие</TableHead><TableHead>Когда</TableHead><TableHead>Организатор</TableHead><TableHead>Статус</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {data.map(({ event: e, host_id, host_name, host_username }) => (
              <TableRow key={e.id}>
                <TableCell className="whitespace-normal"><EntityLink entity="event" id={e.id}>{e.name}</EntityLink></TableCell>
                <TableCell>{wallParts(e.start_at, e.timezone).join(' ')} <Badge variant="outline">{e.timezone}</Badge></TableCell>
                <TableCell><EntityLink entity="user" id={host_id}>{host_name}</EntityLink> {host_username && <TelegramLink username={host_username} />}</TableCell>
                <TableCell><Badge variant={e.status === 'published' ? 'default' : 'secondary'}>{EVENT_STATUS_LABELS[e.status]}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {data?.length === 200 && <Hint>Показаны первые 200 — уточните поиск.</Hint>}
    </Page>
  );
}
