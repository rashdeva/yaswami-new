// Строка журнала и блок «История» в карточке сущности: последние действия команды над ней, с отменой.
import type { AdminActionEntry, AdminEntity, Wire } from '@yaswami/core';
import { ActionLink } from '@/components/EntityLink';
import { Loading, Section } from '@/components/Page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useHistory } from '@/hooks/useActions';
import { useUndo } from '@/hooks/useAct';
import { useUserName } from '@/hooks/useUsers';
import { actionLabel } from '@/lib/journal';

export const when = (iso: string) => new Date(iso).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Кто из команды и через что: админка или агент через MCP (тогда — владелец токена). */
export function Actor({ id, via }: { id: number; via: 'admin' | 'mcp' }) {
  const name = useUserName(id);
  return <span className="inline-flex items-center gap-1">{name}{via === 'mcp' && <Badge variant="secondary">MCP</Badge>}</span>;
}

/** Состояние строки: отменено, это отмена, не отменяется. */
export function ActionState({ a }: { a: Wire<AdminActionEntry> }) {
  if (a.undone_by) return <Badge variant="outline"><ActionLink id={a.undone_by}>отменено</ActionLink></Badge>;
  if (a.undo_of) return <Badge variant="secondary"><ActionLink id={a.undo_of}>отмена действия</ActionLink></Badge>;
  if (!a.undoable) return <Badge variant="outline" className="text-muted-foreground">не отменяется</Badge>;
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
      {error && <p className="text-xs text-muted-foreground">{error.message}</p>}
      {data?.entries.length === 0 && <p className="text-xs text-muted-foreground">Команда ещё ничего здесь не меняла.</p>}
      <ul className="flex flex-col divide-y text-sm">
        {data?.entries.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-2 py-1.5">
            <span className="w-28 shrink-0 text-xs text-muted-foreground">{when(a.created_at)}</span>
            <ActionLink id={a.id}>{actionLabel(a.action)}</ActionLink>
            <span className="text-xs text-muted-foreground"><Actor id={a.actor_id} via={a.via} /></span>
            <ActionState a={a} />
            <span className="ml-auto"><UndoButton a={a} size="xs" /></span>
          </li>
        ))}
      </ul>
      {data?.has_more && <p className="pt-2 text-xs text-muted-foreground">Показаны последние {data.entries.length}; остальное — в «Журнале».</p>}
    </Section>
  );
}
