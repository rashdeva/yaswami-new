// «Люди»: слева собеседники с фильтрами и поиском, справа переписка с выбранным.
import type { AgentKey } from '@yaswami/core';
import { AGENTS } from '@yaswami/core';
import { useState } from 'react';
import { Draft } from '@/components/Draft';
import { Reply } from '@/components/Reply';
import { Thread } from '@/components/Thread';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useConversationActions, useFeed, useThread } from '@/hooks/useInbox';
import { useInboxKeys } from '@/hooks/useInboxKeys';
import type { Filter } from '@/lib/inbox';
import { draftsOf, FILTERS, filterPeople, lastOf, leads, person, pick, time, via } from '@/lib/inbox';

interface Props {
  /** Диалог из адреса; нет или не попал под фильтр — выбран первый в списке. */
  selected: string | undefined;
  agent: AgentKey | undefined;
  onSelect: (conversation: string) => void;
  onAgent: (agent: AgentKey | undefined) => void;
}

export function PeopleScreen({ selected, agent, onSelect, onAgent }: Props) {
  const feed = useFeed();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [edited, setEdited] = useState<Record<string, string>>({}); // наши правки черновиков: id сообщения → текст
  const { send, sendDraft, rejectDraft, toggleMode, done } = useConversationActions();

  const all = feed.conversations;
  const people = filterPeople(all, { filter, agent, query });
  const rows = people.map((c) => ({ key: c.id, c }));
  const { at, cur } = pick(rows, selected ?? '');
  const c = cur?.c;
  const thread = useThread(c?.id);
  const drafts = draftsOf(feed);
  const last = lastOf(feed);
  const draft = c && drafts.get(c.id);
  useInboxKeys({ rows, at, onSelect, draft, draftText: draft && edited[draft.id], scope: '[data-pane]' });

  return (
    <div className="grid h-full grid-rows-[40%_60%] md:grid-cols-[minmax(260px,340px)_1fr] md:grid-rows-1">
      <aside className="flex min-h-0 flex-col gap-2 overflow-y-auto border-b p-3 md:border-r md:border-b-0">
        <Input data-search value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск по имени или @username" />
        <div className="flex flex-wrap gap-1">
          {FILTERS.map(([key, label, match]) => (
            <Button key={key} size="xs" variant={filter === key ? 'default' : 'outline'} onClick={() => setFilter(key)}>{label} {all.filter(match).length}</Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-muted-foreground">Агент:</span>
          <Button size="xs" variant={agent ? 'outline' : 'default'} onClick={() => onAgent(undefined)}>любой</Button>
          {(Object.keys(AGENTS) as AgentKey[]).map((key) => (
            <Button key={key} size="xs" variant={agent === key ? 'default' : 'outline'} onClick={() => onAgent(key)}>
              {AGENTS[key].name} {all.filter((p) => p.agent === key).length}
            </Button>
          ))}
        </div>
        {people.length === 0 && <p className="text-xs text-muted-foreground">Никого нет.</p>}
        {people.map((p) => (
          <button
            key={p.id} type="button" data-selected={p.id === c?.id} onClick={() => onSelect(p.id)}
            className="flex flex-col gap-0.5 rounded-lg border border-transparent p-2 text-left text-sm hover:bg-muted data-[selected=true]:border-border data-[selected=true]:bg-muted"
          >
            <span className="flex justify-between gap-2"><strong className="truncate">{p.peer_name}</strong><span className="shrink-0 text-xs text-muted-foreground">{time(p.last_message_at)}</span></span>
            <span className="truncate text-xs text-muted-foreground">{last.get(p.id)?.direction === 'out' && 'Мы: '}{last.get(p.id)?.text ?? drafts.get(p.id)?.text}</span>
            <span className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">{person(p)}</span>
              {drafts.has(p.id) ? <Badge variant="secondary">черновик</Badge> : p.attention && <Badge variant="destructive">ждёт вас</Badge>}
            </span>
            <span className="text-xs text-muted-foreground">{leads(p)}</span>
          </button>
        ))}
      </aside>

      <section data-pane className="flex min-h-0 min-w-0 flex-col">
        {!c && <p className="m-auto text-sm text-muted-foreground">Выберите человека слева.</p>}
        {c && (
          <>
            <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
              <div className="min-w-0 text-sm">
                <strong>{c.peer_name}</strong>{' '}
                {c.peer_username && <a className="text-xs text-muted-foreground underline" href={`https://t.me/${c.peer_username}`} target="_blank" rel="noreferrer">@{c.peer_username}</a>}
                <div className="text-xs text-muted-foreground">{person(c)} · пишет {via(c, feed.accounts)} · {leads(c)}</div>
                {c.attention && <div className="text-xs text-amber-700 dark:text-amber-400">Ждёт вас: {c.attention}</div>}
              </div>
              <div className="flex gap-2">
                {c.attention && <Button size="sm" variant="outline" onClick={() => done(c)}>Готово</Button>}
                <Button size="sm" variant="outline" onClick={() => toggleMode(c)}>{c.mode === 'agent' ? 'Взять на себя' : 'Вернуть агенту'}</Button>
              </div>
            </header>
            <Thread conversation={c} messages={thread} me={feed.me} through={via(c, feed.accounts)} />
            {draft && (
              <Draft
                className="border-t px-4 py-3" draft={draft} text={edited[draft.id]} onEdit={(text) => setEdited({ ...edited, [draft.id]: text })}
                onSend={() => sendDraft({ id: draft.id, text: edited[draft.id] })} onReject={() => rejectDraft(draft.id)}
              />
            )}
            <Reply className="border-t px-4 py-3" onSend={(text) => send({ id: c.id, text })} />
          </>
        )}
      </section>
    </div>
  );
}
