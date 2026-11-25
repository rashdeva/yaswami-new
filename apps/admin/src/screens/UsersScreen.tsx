// «Пользователи»: все, кто входил в сервис, пришедшие последними сверху; поиск по имени или @username.
import { Ago, Arrival } from '@/components/ActivityFeed';
import { EntityLink, TelegramLink } from '@/components/EntityLink';
import { Failed, Loading, Nothing, Page } from '@/components/Page';
import { Search } from '@/components/Search';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useUsers } from '@/hooks/useUsers';
import { IDENTITY_LABELS } from '@/lib/catalog';

export function UsersScreen({ query, onQuery }: { query: string; onQuery: (query: string) => void }) {
  const { data, error, isPending } = useUsers(query.trim().replace(/^@/, ''));
  return (
    <Page title="Пользователи" description={query ? undefined : 'Без поиска — 50 пришедших последними. Кто куда записывается — в «Активности».'}>
      <Search value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Имя или @username" />
      {isPending && <Loading />}
      {error && <Failed error={error} />}
      {data?.length === 0 && <Nothing title="Никого не нашлось" />}
      {!!data?.length && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Имя</TableHead><TableHead>Username</TableHead><TableHead>Пришёл</TableHead><TableHead>Откуда</TableHead>
              <TableHead>Был</TableHead><TableHead className="text-right">Записей</TableHead><TableHead>Вход</TableHead><TableHead>Язык</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((u) => (
              <TableRow key={u.id}>
                <TableCell><EntityLink entity="user" id={u.id}>{u.first_name}</EntityLink></TableCell>
                <TableCell>{u.username ? <TelegramLink username={u.username} /> : '—'}</TableCell>
                <TableCell>{u.created_at ? <Ago at={u.created_at} /> : '—'}</TableCell>
                <TableCell className="whitespace-normal"><Arrival via={u.joined_via} start={u.start_param} /></TableCell>
                <TableCell>{u.last_seen_at ? <Ago at={u.last_seen_at} /> : '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{u.registrations || '—'}</TableCell>
                <TableCell>{u.identities.map((i) => IDENTITY_LABELS[i]).join(', ') || '—'}</TableCell>
                <TableCell>{u.lang}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Page>
  );
}
