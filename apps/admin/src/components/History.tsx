// Строка журнала и блок «История» в карточке сущности: последние действия команды над ней, с отменой.
import type { AdminActionEntry, AdminEntity, Wire } from '@yaswami/core';
import { Fragment } from 'react';
import { ActionLink } from '@/components/EntityLink';
import { Hint, Loading, Section } from '@/components/Page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemSeparator, ItemTitle } from '@/components/ui/item';
import { useHistory, useScopeHistory } from '@/hooks/useActions';
import { EntityLink } from '@/components/EntityLink';
import { useUndo } from '@/hooks/useAct';
import { useUserName } from '@/hooks/useUsers';
import { actionLabel } from '@/lib/journal';

export const when = (iso: string) => new Date(iso).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Кто из команды и через что: админка или агент через MCP (тогда — владелец токена). */
export function Actor({ id, via }: { id: number; via: 'admin' | 'mcp' }) {
  const name = useUserName(id);
  return <>{name}{via === 'mcp' && <> <Badge variant="secondary">MCP</Badge></>}</>;
}

/** Состояние строки: отменено, это отмена, не отменяется. */
export function ActionState({ a }: { a: Wire<AdminActionEntry> }) {
  if (a.undone_by) return <Badge variant="outline"><ActionLink id={a.undone_by}>отменено</ActionLink></Badge>;
  if (a.undo_of) return <Badge variant="secondary"><ActionLink id={a.undo_of}>отмена действия</ActionLink></Badge>;
  if (!a.undoable) return <Badge variant="outline">не отменяется</Badge>;
  return null;
}

/** Кнопка отмены: у отменяемого и ещё не отменённого. У отмены она называется «Вернуть». */
export function UndoButton({ a, size = 'sm' }: { a: Wire<AdminActionEntry>; size?: 'sm' | 'xs' | 'default' }) {
  const undo = useUndo();
  if (!a.undoable || a.undone_by) return null;
  return <Button size={size} variant="outline" onClick={() => undo(a.id, actionLabel(a.action))}>{a.undo_of ? 'Вернуть' : 'Отменить'}</Button>;
}

export function History({ entity, id }: { entity: AdminEntity; id: string | number }) {
  const { data, error } = useHistory(entity, String(id));
  return (
    <Section title="История">
      {!data && !error && <Loading rows={2} />}
      {error && <Hint>{error.message}</Hint>}
      {data?.entries.length === 0 && <Hint>Команда ещё ничего здесь не меняла.</Hint>}
      <ItemGroup className="gap-0">
        {data?.entries.map((a, i) => (
          <Fragment key={a.id}>
            {i > 0 && <ItemSeparator />}
            <Item size="xs" className="px-0">
              <ItemContent>
                <ItemTitle><ActionLink id={a.id}>{actionLabel(a.action)}</ActionLink><ActionState a={a} /></ItemTitle>
                <ItemDescription>{when(a.created_at)} · <Actor id={a.actor_id} via={a.via} /></ItemDescription>
              </ItemContent>
              <ItemActions><UndoButton a={a} size="xs" /></ItemActions>
            </Item>
          </Fragment>
        ))}
      </ItemGroup>
      {data?.has_more && <Hint>Показаны последние {data.entries.length}; остальное — в «Журнале».</Hint>}
    </Section>
  );
}

/** Что правка поменяла, одной строкой: «→ путешествия», «снято с публикации», «выключена». */
const change = (input: unknown) => {
  const i = (input ?? {}) as { topic?: string; status?: string; enabled?: boolean; name?: string; split_from?: string };
  if (i.status === 'rejected') return 'снято с публикации';
  if (i.topic) return `→ ${i.topic}`;
  if (i.enabled === false) return 'выключена';
  if (i.split_from) return `выделена из «${i.split_from}»`;
  return null;
};

/** Правки хранителя тем (роль librarian, ADR-0010): что он перенёс, завёл и выключил — с отменой. */
export function LibrarianLog() {
  const { data, error } = useScopeHistory('librarian');
  return (
    <Section title="Правки хранителя тем" description="Роль раз в день сверяет события с темами: переносит, снимает не-события, заводит и выключает темы. Неверное — отмените.">
      {!data && !error && <Loading rows={2} />}
      {error && <Hint>{error.message}</Hint>}
      {data?.entries.length === 0 && <Hint>Хранитель ещё ничего не менял.</Hint>}
      <ItemGroup className="gap-0">
        {data?.entries.map((a, i) => (
          <Fragment key={a.id}>
            {i > 0 && <ItemSeparator />}
            <Item size="xs" className="px-0">
              <ItemContent>
                <ItemTitle><ActionLink id={a.id}>{actionLabel(a.action)}</ActionLink><ActionState a={a} /></ItemTitle>
                <ItemDescription>{when(a.created_at)} · <EntityLink entity={a.entity} id={a.entity_id}>{a.entity_id}</EntityLink>{change(a.input) && <> · {change(a.input)}</>}</ItemDescription>
              </ItemContent>
              <ItemActions><UndoButton a={a} size="xs" /></ItemActions>
            </Item>
          </Fragment>
        ))}
      </ItemGroup>
    </Section>
  );
}
