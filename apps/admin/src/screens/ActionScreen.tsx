// Карточка действия журнала: кто, что и над чем; что изменилось; снимки целиком; отмена.
import { ChevronDownIcon } from 'lucide-react';
import { ActionLink, EntityLink } from '@/components/EntityLink';
import { ActionState, Actor, UndoButton, when } from '@/components/History';
import { Failed, Hint, Loading, Page, Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useAction } from '@/hooks/useActions';
import { actionLabel, CHILDREN, ENTITIES, showValue, snapshotDiff } from '@/lib/journal';

const KIND = { created: 'Создано', deleted: 'Удалено', changed: 'Изменено' } as const;

function Raw({ title, value }: { title: string; value: unknown }) {
  return (
    <Collapsible>
      <CollapsibleTrigger asChild><Button size="sm" variant="ghost">{title}<ChevronDownIcon /></Button></CollapsibleTrigger>
      <CollapsibleContent>
        <Textarea readOnly value={JSON.stringify(value, null, 2)} className="max-h-96 font-mono text-xs" />
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
      <Table>
        <TableBody>
          {[
            ['Когда', when(a.created_at)],
            ['Кто', <><Actor id={a.actor_id} via={a.via} /> · {a.via === 'mcp' ? 'агент через MCP' : 'в админке'}</>],
            ['Над чем', <>{ENTITIES[a.entity]}: <EntityLink entity={a.entity} id={a.entity_id}>{a.entity_id}</EntityLink></>],
            ['Инструмент', a.action],
            ...(a.undo_of ? [['Отменяет', <ActionLink id={a.undo_of}>действие</ActionLink>]] : []),
            ...(a.undone_by ? [['Отменено', <ActionLink id={a.undone_by}>этим действием</ActionLink>]] : []),
          ].map(([label, value]) => (
            <TableRow key={label as string}><TableCell className="w-32 text-muted-foreground">{label}</TableCell><TableCell>{value}</TableCell></TableRow>
          ))}
        </TableBody>
      </Table>

      <Section title={`Что изменилось · ${KIND[diff.kind]}`}>
        {diff.fields.length === 0 && <Hint>Поля самой записи не менялись.</Hint>}
        {diff.fields.length > 0 && (
          <Table>
            <TableHeader><TableRow><TableHead>Поле</TableHead><TableHead>Было</TableHead><TableHead>Стало</TableHead></TableRow></TableHeader>
            <TableBody>
              {diff.fields.map((f) => (
                <TableRow key={f.key}>
                  <TableCell>{f.key}</TableCell>
                  <TableCell className="max-w-xs whitespace-pre-wrap text-muted-foreground">{showValue(f.before)}</TableCell>
                  <TableCell className="max-w-xs whitespace-pre-wrap">{showValue(f.after)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {diff.children.length > 0 && (
          <ItemGroup className="mt-3 grid gap-2 sm:grid-cols-2">
            {diff.children.map((c) => (
              <Item key={c.name} size="xs" variant={c.changed ? 'outline' : 'muted'}>
                <ItemContent>
                  <ItemTitle>{CHILDREN[c.name] ?? c.name}</ItemTitle>
                  <ItemDescription>{c.before ?? '—'} → {c.after ?? '—'}{c.changed && c.before === c.after ? ' (изменены)' : ''}</ItemDescription>
                </ItemContent>
              </Item>
            ))}
          </ItemGroup>
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
