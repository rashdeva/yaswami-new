// «Пользователи»: все, кто входил в сервис; поиск по имени или @username.
import { EntityLink } from '@/components/EntityLink';
import { Failed, Loading, Nothing, Page } from '@/components/Page';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useUsers } from '@/hooks/useUsers';

export function UsersScreen({ query, onQuery }: { query: string; onQuery: (query: string) => void }) {
  const { data, error, isPending } = useUsers(query.trim().replace(/^@/, ''));
  return (
    <Page title="Пользователи">
      <Input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Имя или @username" />
      {!query && <p className="text-xs text-muted-foreground">Без поиска — первые 50 по имени.</p>}
      {isPending && <Loading />}
      {error && <Failed error={error} />}
      {data?.length === 0 && <Nothing title="Никого не нашлось" />}
      {!!data?.length && (
        <Table>
          <TableHeader><TableRow><TableHead>Имя</TableHead><TableHead>Username</TableHead><TableHead>Telegram id</TableHead><TableHead>Язык</TableHead><TableHead>Пояс</TableHead></TableRow></TableHeader>
          <TableBody>
            {data.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium"><EntityLink entity="user" id={u.id}>{u.first_name}</EntityLink></TableCell>
                <TableCell>{u.username ? `@${u.username}` : '—'}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{u.id}</TableCell>
                <TableCell>{u.lang}</TableCell>
                <TableCell className="text-xs">{u.timezone}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Page>
  );
}
