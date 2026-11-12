// Карточка действия журнала: кто, что и над чем; что изменилось; снимки целиком; отмена.
import { ChevronDownIcon } from 'lucide-react';
import { ActionLink, EntityLink } from '@/components/EntityLink';
import { ActionState, Actor, UndoButton, when } from '@/components/History';
import { Failed, Loading, Page, Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAction } from '@/hooks/useActions';
import { actionLabel, CHILDREN, ENTITIES, showValue, snapshotDiff } from '@/lib/journal';

const KIND = { created: 'Создано', deleted: 'Удалено', changed: 'Изменено' } as const;

function Raw({ title, value }: { title: string; value: unknown }) {
  return (
    <Collapsible>
      <CollapsibleTrigger asChild><Button size="sm" variant="ghost">{title}<ChevronDownIcon /></Button></CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(value, null, 2)}</pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ActionScreen({ id }: { id: string }) {
  const { data: a, error } = useAction(id);
  if (error) return <Page title="Действие"><Failed error={error} /></Page>;
  if (!a) return <Page title="Действие"><Loading rows={6} /></Page>;
  const diff = snapshotDiff(a.before, a.after);

  return (
    <Page title={<>{actionLabel(a.action)} <ActionState a={a} /></>} actions={<UndoButton a={a} />}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Когда</dt><dd>{when(a.created_at)}</dd>
        <dt className="text-muted-foreground">Кто</dt><dd><Actor id={a.actor_id} via={a.via} /> · {a.via === 'mcp' ? 'агент через MCP' : 'в админке'}</dd>
        <dt className="text-muted-foreground">Над чем</dt>
        <dd>{ENTITIES[a.entity]}: <EntityLink entity={a.entity} id={a.entity_id}><span className="font-mono">{a.entity_id}</span></EntityLink></dd>
        <dt className="text-muted-foreground">Инструмент</dt><dd className="font-mono text-xs">{a.action}</dd>
        {a.undo_of && <><dt className="text-muted-foreground">Отменяет</dt><dd><ActionLink id={a.undo_of}>действие</ActionLink></dd></>}
        {a.undone_by && <><dt className="text-muted-foreground">Отменено</dt><dd><ActionLink id={a.undone_by}>этим действием</ActionLink></dd></>}
      </dl>

      <Section title={`Что изменилось · ${KIND[diff.kind]}`}>
        {diff.fields.length === 0 && <p className="text-xs text-muted-foreground">Поля самой записи не менялись.</p>}
        {diff.fields.length > 0 && (
          <Table>
            <TableHeader><TableRow><TableHead>Поле</TableHead><TableHead>Было</TableHead><TableHead>Стало</TableHead></TableRow></TableHeader>
            <TableBody>
              {diff.fields.map((f) => (
                <TableRow key={f.key}>
                  <TableCell className="font-mono text-xs">{f.key}</TableCell>
                  <TableCell className="max-w-xs text-xs whitespace-pre-wrap text-muted-foreground">{showValue(f.before)}</TableCell>
                  <TableCell className="max-w-xs text-xs whitespace-pre-wrap">{showValue(f.after)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {diff.children.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {diff.children.map((c) => (
              <li key={c.name} className={c.changed ? '' : 'text-muted-foreground'}>
                {CHILDREN[c.name] ?? c.name}: {c.before ?? '—'} → {c.after ?? '—'}{c.changed && c.before === c.after ? ' (изменены)' : ''}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Подробности">
        <Raw title="Что передали" value={a.input} />
        <Raw title="Снимок до" value={a.before} />
        <Raw title="Снимок после" value={a.after} />
      </Section>
    </Page>
  );
}
