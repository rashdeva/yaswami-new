// «Журнал»: всё, что команда меняла в сервисе — в админке и через MCP, — новое сверху, с отменой.
import type { AdminEntity } from '@yaswami/core';
import { ADMIN_ENTITIES } from '@yaswami/core';
import { ActionLink, EntityLink } from '@/components/EntityLink';
import { ActionState, Actor, UndoButton, when } from '@/components/History';
import { Failed, Loading, LoadMore, Nothing, Page } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useActionFeed } from '@/hooks/useActions';
import { useFeed } from '@/hooks/useInbox';
import { useUserName } from '@/hooks/useUsers';
import { ACTIONS, actionLabel, ENTITIES } from '@/lib/journal';

export interface ActionsFilter { entity?: AdminEntity; action?: string; actor?: number }
const ANY = '__any';

function Pick({ value, options, placeholder, onChange }: { value?: string; options: [string, string][]; placeholder: string; onChange: (v: string | undefined) => void }) {
  return (
    <Select value={value ?? ANY} onValueChange={(v) => onChange(v === ANY ? undefined : v)}>
      <SelectTrigger size="sm" className="min-w-40"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>{placeholder}</SelectItem>
        {options.map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** Имя админа в списке отбора. */
const ActorName = ({ id }: { id: number }) => <>{useUserName(id)}</>;

export function ActionsScreen({ filter, onFilter }: { filter: ActionsFilter; onFilter: (f: ActionsFilter) => void }) {
  const { me } = useFeed();
  const { entries, error, isPending, hasNextPage, isFetchingNextPage, fetchNextPage } = useActionFeed({ entity: filter.entity, action: filter.action, actor_id: filter.actor });
  // Кого показать в отборе: себя и всех, кто встретился в загруженной ленте.
  const actors = [...new Set([me, ...(entries ?? []).map((a) => a.actor_id), ...(filter.actor ? [filter.actor] : [])])];

  return (
    <Page title="Журнал" description="Каждое изменение команды: кто, когда, через что и над чем. Отменить можно всё, что не ушло людям в Telegram, не стоило денег и не касалось входа.">
      <div className="flex flex-wrap items-center gap-2">
        <Pick value={filter.entity} placeholder="Любая сущность" options={ADMIN_ENTITIES.map((e) => [e, ENTITIES[e]])} onChange={(v) => onFilter({ ...filter, entity: v as AdminEntity | undefined })} />
        <Pick value={filter.action} placeholder="Любое действие" options={Object.entries(ACTIONS)} onChange={(v) => onFilter({ ...filter, action: v })} />
        <Select value={filter.actor ? String(filter.actor) : ANY} onValueChange={(v) => onFilter({ ...filter, actor: v === ANY ? undefined : Number(v) })}>
          <SelectTrigger size="sm" className="min-w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Любой из команды</SelectItem>
            {actors.map((id) => <SelectItem key={id} value={String(id)}>{id === me ? 'Я' : <ActorName id={id} />}</SelectItem>)}
          </SelectContent>
        </Select>
        {(filter.entity || filter.action || filter.actor) && <Button size="sm" variant="ghost" onClick={() => onFilter({})}>Сбросить</Button>}
      </div>
      {isPending && <Loading rows={8} />}
      {error && <Failed error={error} />}
      {entries?.length === 0 && <Nothing title="Пусто" hint="Под этот отбор действий нет." />}
      {!!entries?.length && (
        <Table>
          <TableHeader>
            <TableRow><TableHead>Когда</TableHead><TableHead>Кто</TableHead><TableHead>Что сделано</TableHead><TableHead>Над чем</TableHead><TableHead /><TableHead /></TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="text-muted-foreground">{when(a.created_at)}</TableCell>
                <TableCell><Actor id={a.actor_id} via={a.via} /></TableCell>
                <TableCell><ActionLink id={a.id}>{actionLabel(a.action)}</ActionLink></TableCell>
                <TableCell>
                  {ENTITIES[a.entity]}: <EntityLink entity={a.entity} id={a.entity_id}>{a.entity_id}</EntityLink>
                </TableCell>
                <TableCell><ActionState a={a} /></TableCell>
                <TableCell className="text-right"><UndoButton a={a} size="xs" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <LoadMore more={!!hasNextPage} loading={isFetchingNextPage} onMore={() => void fetchNextPage()} />
    </Page>
  );
}
