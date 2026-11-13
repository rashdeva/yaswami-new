// «Мастера и услуги»: профили, собранные по открытым анонсам, на каком шаге переписка с каждым и все их услуги одним списком.
import { BanIcon, CheckIcon } from 'lucide-react';
import { INBOX_STAGES, OTHER_TOPIC, TOPIC_GUIDES } from '@yaswami/core';
import { useState } from 'react';
import { CityBadge } from '@/components/City';
import { EntityLink, TelegramLink } from '@/components/EntityLink';
import { Failed, Hint, Loading, Nothing, Page } from '@/components/Page';
import { Search } from '@/components/Search';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Item, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useHostCreate, useHosts, useHostStatus } from '@/hooks/useHosts';
import { useOverview } from '@/hooks/useOverview';
import { HOST_LABELS } from '@/lib/catalog';

interface Props {
  query: string;
  /** queue — только ждущие решения мастера (есть Practice и статус pending); services — все услуги одним списком. */
  tab: 'all' | 'queue' | 'services';
  onTab: (tab: Props['tab']) => void;
  /** Тема, по которой отобраны услуги. */
  topic: string | null;
  onTopic: (topic: string | null) => void;
  onQuery: (query: string) => void;
  onOpen: (conversation: string) => void;
  /** Организатора добавили по username — открыть его карточку. */
  onCreated: (id: string) => void;
}

const ALL = 'all';

export function HostsScreen({ query, tab, onTab, topic, onTopic, onQuery, onOpen, onCreated }: Props) {
  const queue = tab === 'queue';
  const create = useHostCreate();
  const decide = useHostStatus();
  const [username, setUsername] = useState('');
  const { data: hosts, error } = useHosts();
  const overview = useOverview();
  const stats = new Map(overview?.hosts.map((h) => [h.username, h]));
  const q = query.trim().toLowerCase().replace(/^@/, '');
  const waiting = (hosts ?? []).filter((h) => h.status === 'pending' && h.practices.length > 0);
  const rows = (queue ? waiting : hosts ?? [])
    .filter((h) => !q || [h.name, h.username, h.channel].some((s) => s?.toLowerCase().includes(q)))
    .map((h) => ({ h, s: stats.get(h.username) }))
    .sort((a, b) => (b.s?.signups ?? 0) - (a.s?.signups ?? 0) || (b.s?.events ?? 0) - (a.s?.events ?? 0));
  const all = (hosts ?? []).flatMap((h) => h.practices.map((p) => ({ h, p, signups: h.practice_signup_counts[p.title] ?? 0 })));
  const topics = [...Object.keys(TOPIC_GUIDES), OTHER_TOPIC].filter((t) => all.some((x) => x.p.topic === t));
  const services = all
    .filter(({ h, p }) => (!topic || p.topic === topic) && (!q || [p.title, h.name, h.username].some((s) => s.toLowerCase().includes(q))))
    .sort((a, b) => b.signups - a.signups || a.p.title.localeCompare(b.p.title));

  return (
    <Page title={<>Мастера и услуги <Badge>{hosts?.length ?? '…'}</Badge></>} description="Профили собраны по открытым анонсам. «Записей» — сколько раз на предстоящие события организатора нажали «Записаться» у нас. Нужного нет — добавьте по username: сборщик найдёт его в Telegram и на следующем проходе заполнит имя, «о себе», канал и сводку.">
      <form className="flex max-w-md gap-2" onSubmit={(e) => (e.preventDefault(), username.trim() && create({ username: username.trim() }, { onSuccess: (h) => (setUsername(''), onCreated(h.id)) }))}>
        <Input placeholder="@username или t.me/username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <Button type="submit" variant="outline">Добавить</Button>
      </form>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={tab === 'all' ? 'default' : 'outline'} onClick={() => onTab('all')}>Все</Button>
        <Button size="sm" variant={queue ? 'default' : 'outline'} onClick={() => onTab('queue')}>Ждут решения <Badge variant="secondary">{waiting.length}</Badge></Button>
        <Button size="sm" variant={tab === 'services' ? 'default' : 'outline'} onClick={() => onTab('services')}>Услуги <Badge variant="secondary">{all.length}</Badge></Button>
        <Hint>Мастера из чатов попадают в каталог только после «Опубликовать» — здесь или в их карточке.</Hint>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Search value={query} onChange={(e) => onQuery(e.target.value)} placeholder={tab === 'services' ? 'Услуга, имя или @username' : 'Имя, @username или канал'} />
        {tab === 'services' && (
          <Select value={topic ?? ALL} onValueChange={(v) => onTopic(v === ALL ? null : v)}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Все темы</SelectItem>
              {topics.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>
      {!hosts && !error && <Loading />}
      {error && <Failed error={error} />}
      {tab === 'services' && hosts && services.length === 0 && <Nothing title="Услуг не нашлось" />}
      {tab === 'services' && services.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow><TableHead>Услуга</TableHead><TableHead>Тема</TableHead><TableHead>Цена</TableHead><TableHead>Мастер</TableHead><TableHead>В каталоге</TableHead><TableHead>Заявок</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {services.map(({ h, p, signups }) => (
              <TableRow key={h.id + p.title}>
                <TableCell className="max-w-md align-top whitespace-normal">
                  <Item size="xs" className="p-0">
                    <ItemContent>
                      <ItemTitle>{p.title}</ItemTitle>
                      {p.description && <ItemDescription>{p.description}</ItemDescription>}
                    </ItemContent>
                  </Item>
                </TableCell>
                <TableCell className="align-top"><Badge variant="secondary">{p.topic}</Badge></TableCell>
                <TableCell className="align-top">{p.price ?? <Hint>по запросу</Hint>}</TableCell>
                <TableCell className="align-top">
                  <Item size="xs" className="p-0">
                    <ItemContent>
                      <ItemTitle><EntityLink entity="host" id={h.id}>{h.name}</EntityLink></ItemTitle>
                      <ItemDescription><TelegramLink username={h.username} /></ItemDescription>
                    </ItemContent>
                  </Item>
                </TableCell>
                {/* Видна во вкладке «Услуги» — только у опубликованного мастера и только из наших тем. */}
                <TableCell className="align-top">
                  {h.status === 'published' && p.topic !== OTHER_TOPIC ? <Badge>видна</Badge> : <Badge variant="outline">{p.topic === OTHER_TOPIC ? 'не наша тема' : HOST_LABELS[h.status].toLowerCase()}</Badge>}
                </TableCell>
                <TableCell className="align-top">{signups}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {tab !== 'services' && hosts && rows.length === 0 && <Nothing title="Никого не нашлось" />}
      {tab !== 'services' && rows.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow><TableHead>Организатор</TableHead><TableHead>Статус</TableHead><TableHead>О нём</TableHead><TableHead>Событий</TableHead><TableHead>Записей</TableHead><TableHead>В сервисе</TableHead><TableHead>Переписка</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ h, s }) => (
              <TableRow key={h.id}>
                <TableCell className="align-top">
                  <Item size="xs" className="p-0">
                    <ItemContent>
                      <ItemTitle><EntityLink entity="host" id={h.id}>{h.name}</EntityLink></ItemTitle>
                      <ItemDescription><TelegramLink username={h.username} /></ItemDescription>
                      {h.channel && <ItemDescription>канал <TelegramLink username={h.channel} /></ItemDescription>}
                      <ItemDescription><CityBadge id={h.city_id} /></ItemDescription>
                    </ItemContent>
                  </Item>
                </TableCell>
                <TableCell className="align-top"><Badge variant={h.status === 'published' ? 'default' : 'secondary'}>{HOST_LABELS[h.status]}</Badge>{!h.telegram_id && h.status === 'pending' && <> <Badge variant="outline">проверяется</Badge></>}
                  {/* Решение — сразу из списка; пока сборщик не нашёл его в Telegram, решать не по чему. */}
                  {h.telegram_id && h.status === 'pending' && (
                    <div className="mt-1.5 flex gap-1">
                      <Button size="xs" onClick={() => decide({ id: h.id, status: 'published' })}><CheckIcon />Опубликовать</Button>
                      <Button size="xs" variant="outline" onClick={() => decide({ id: h.id, status: 'rejected' })}><BanIcon />Отклонить</Button>
                    </div>
                  )}
                </TableCell>
                <TableCell className="max-w-md align-top whitespace-normal"><Hint>{h.practices.length ? h.practices.map((p) => p.title).join(' · ') : h.summary ?? '—'}</Hint></TableCell>
                <TableCell>{s?.events ?? 0}</TableCell>
                <TableCell>{s?.signups ?? 0}</TableCell>
                <TableCell>
                  {h.user_id ? <Badge variant="outline"><EntityLink entity="user" id={h.user_id}>вошёл</EntityLink></Badge> : <Hint>нет</Hint>}
                </TableCell>
                <TableCell>
                  {s?.conversation_id
                    ? <Button variant="outline" size="xs" onClick={() => onOpen(s.conversation_id!)}>{INBOX_STAGES[s.stage!]}</Button>
                    : <Hint>не писали</Hint>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Page>
  );
}
