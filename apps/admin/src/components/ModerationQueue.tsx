// «Ждут решения» в «Ленте»: события каталога, услуги и мастера, которые ждут решения команды, —
// одной очередью с решением по строке и пачкой. Что именно делает решение — lib/moderation.ts и hooks/useModeration.ts.
import { useState } from 'react';
import { Confirm } from '@/components/Confirm';
import { EntityLink, ExternalLink } from '@/components/EntityLink';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Marker, MarkerContent } from '@/components/ui/marker';
import { useModeration } from '@/hooks/useModeration';
import type { Decision } from '@/lib/moderation';
import { moderationTotal } from '@/lib/moderation';

/** Чекбокса shadcn в админке нет — нативный; он же `input`, поэтому клавиши ленты (useInboxKeys) его не трогают. */
const Check = ({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (on: boolean) => void }) => (
  <input type="checkbox" aria-label={label} className="size-4 accent-primary" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
);

export function ModerationQueue() {
  const { groups, busy, decide, decideMany } = useModeration();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  // Считаем только то, что ещё в очереди: решённое в другом месте из выбора выпадает само.
  const chosen = groups.flatMap((g) => g.rows).filter((r) => selected.has(r.key)).length;
  const toggle = (keys: string[], on: boolean) => setSelected((s) => { const n = new Set(s); for (const k of keys) if (on) n.add(k); else n.delete(k); return n; });
  const batch = async (decision: Decision) => setSelected(await decideMany(selected, decision));

  if (!groups.length) return null;
  return (
    <>
      <Marker variant="separator"><MarkerContent>Ждут решения · {moderationTotal(groups)}</MarkerContent></Marker>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!chosen || busy} onClick={() => void batch('approve')}>Одобрить выбранные ({chosen})</Button>
        <Confirm
          title={`Отклонить выбранные: ${chosen}?`} action="Отклонить" onConfirm={() => void batch('reject')}
          description="Отклонённое нигде не показывается; мастер скрывается вместе со своими событиями и услугами. Каждое отклонение — отдельная запись в «Журнале», отменить можно там же."
        >
          <Button size="sm" variant="outline" disabled={!chosen || busy}>Отклонить выбранные ({chosen})</Button>
        </Confirm>
      </div>
      {groups.map((g) => {
        const keys = g.rows.map((r) => r.key);
        return (
          <ItemGroup key={g.kind} className="gap-1">
            <Item size="xs">
              <ItemMedia><Check label={`Выбрать все: ${g.label}`} checked={keys.every((k) => selected.has(k))} disabled={busy} onChange={(on) => toggle(keys, on)} /></ItemMedia>
              <ItemContent><ItemTitle>{g.label} <Badge variant="secondary">{g.rows.length}</Badge></ItemTitle></ItemContent>
            </Item>
            {g.rows.map((r) => (
              <Item key={r.key} size="xs" variant={selected.has(r.key) ? 'muted' : 'default'}>
                <ItemMedia><Check label={`Выбрать: ${r.title}`} checked={selected.has(r.key)} disabled={busy} onChange={(on) => toggle([r.key], on)} /></ItemMedia>
                <ItemContent>
                  <ItemTitle><EntityLink entity={r.link.entity} id={r.link.id}>{r.title}</EntityLink></ItemTitle>
                  <ItemDescription>{r.subtitle}{r.url && <> · <ExternalLink href={r.url} icon>источник</ExternalLink></>}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <ButtonGroup>
                    <Button size="xs" disabled={busy} onClick={() => decide(r, 'approve')}>Одобрить</Button>
                    <Button size="xs" variant="outline" disabled={busy} onClick={() => decide(r, 'reject')}>Отклонить</Button>
                  </ButtonGroup>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        );
      })}
    </>
  );
}
