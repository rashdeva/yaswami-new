// «Пользователи»: все, кто входил в сервис; поиск по имени или @username.
import { EntityLink, TelegramLink } from '@/components/EntityLink';
import { Failed, Loading, Nothing, Page } from '@/components/Page';
import { Search } from '@/components/Search';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useUsers } from '@/hooks/useUsers';
import { IDENTITY_LABELS } from '@/lib/catalog';

export function UsersScreen({ query, onQuery }: { query: string; onQuery: (query: string) => void }) {
  const { data, error, isPending } = useUsers(query.trim().replace(/^@/, ''));
  return (
    <Page title="Пользователи" description={query ? undefined : 'Без поиска — первые 50 по имени.'}>
      <Search value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Имя или @username" />
      {isPending && <Loading />}
      {error && <Failed error={error} />}
      {data?.length === 0 && <Nothing title="Никого не нашлось" />}
      {!!data?.length && (
        <Table>
          <TableHeader><TableRow><TableHead>Имя</TableHead><TableHead>Username</TableHead><TableHead>Вход</TableHead><TableHead>Telegram id</TableHead><TableHead>Язык</TableHead><TableHead>Пояс</TableHead></TableRow></TableHeader>
          <TableBody>
            {data.map((u) => (
              <TableRow key={u.id}>
                <TableCell><EntityLink entity="user" id={u.id}>{u.first_name}</EntityLink></TableCell>
                <TableCell>{u.username ? <TelegramLink username={u.username} /> : '—'}</TableCell>
                <TableCell>{u.identities.map((i) => IDENTITY_LABELS[i]).join(', ') || '—'}</TableCell>
                <TableCell className="text-muted-foreground">{u.telegram_id ?? '—'}</TableCell>
                <TableCell>{u.lang}</TableCell>
                <TableCell>{u.timezone}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Page>
  );
}
