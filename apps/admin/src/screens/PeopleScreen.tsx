// «Люди»: слева собеседники с фильтрами и поиском, справа переписка с выбранным.
import type { AgentKey } from '@yaswami/core';
import { AGENTS } from '@yaswami/core';
import { BotIcon, CheckIcon, CircleAlertIcon, EyeIcon, EyeOffIcon, HandIcon, PencilLineIcon, SendIcon } from 'lucide-react';
import { useState } from 'react';
import { Draft } from '@/components/Draft';
import { TelegramLink } from '@/components/EntityLink';
import { Hint, Nothing } from '@/components/Page';
import { Reply } from '@/components/Reply';
import { Search } from '@/components/Search';
import { Thread } from '@/components/Thread';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarBadge, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Kbd } from '@/components/ui/kbd';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useConversationActions, useFeed, useSendFrom, useThread } from '@/hooks/useInbox';
import { useInboxKeys } from '@/hooks/useInboxKeys';
import { useTyping } from '@/hooks/useLive';
import type { Filter } from '@/lib/inbox';
import { accountLabel, draftsOf, FILTERS, filterPeople, initials, lastOf, leads, person, pick, time, typingText, via } from '@/lib/inbox';

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
  const { send, sendDraft, saveDraft, rejectDraft, toggleMode, done, toggleHidden } = useConversationActions();

  const all = feed.conversations;
  const people = filterPeople(all, { filter, agent, query });
  const rows = people.map((c) => ({ key: c.id, c }));
  const { at, cur } = pick(rows, selected ?? '');
  const c = cur?.c;
  const thread = useThread(c?.id);
  const drafts = draftsOf(feed);
  const last = lastOf(feed);
  const draft = c && drafts.get(c.id);
  const typing = useTyping();
  const from = useSendFrom(feed.accounts);
  useInboxKeys({ rows, at, onSelect, draft, draftText: draft && edited[draft.id], account: c && from(c).account, scope: '[data-pane]' });

  return (
    <div className="grid h-full grid-rows-2 md:grid-cols-3 md:grid-rows-1 xl:grid-cols-4">
      <aside className="flex min-h-0 flex-col border-b md:border-r md:border-b-0">
        <div className="flex flex-col gap-2 border-b p-3">
          <Search data-search kbd="/" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Имя или @username" />
          <div className="flex items-center gap-2">
            <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={filter} onValueChange={(v) => v && setFilter(v as Filter)} className="min-w-0 flex-1 overflow-x-auto">
              {FILTERS.filter(([key]) => key !== 'hidden').map(([key, label, match]) => (
                <ToggleGroupItem key={key} value={key} className="grow">
                  {label}<span className="text-muted-foreground tabular-nums">{all.filter(match).length}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {/* Скрытые — отдельно: смотрят редко, только чтобы вернуть диалог руками. */}
            <Toggle
              variant="outline" size="sm" aria-label="Скрытые" title="Скрытые"
              pressed={filter === 'hidden'} onPressedChange={(on) => setFilter(on ? 'hidden' : 'all')}
            >
              <EyeOffIcon /><span className="text-muted-foreground tabular-nums">{all.filter((p) => p.hidden_at).length}</span>
            </Toggle>
          </div>
          <Select value={agent ?? 'any'} onValueChange={(v) => onAgent(v === 'any' ? undefined : (v as AgentKey))}>
            <SelectTrigger size="sm" className="w-full"><BotIcon className="text-muted-foreground" /><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Любой агент</SelectItem>
              {(Object.keys(AGENTS) as AgentKey[]).map((key) => (
                <SelectItem key={key} value={key}>{AGENTS[key].name} · {all.filter((p) => p.agent === key).length}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {people.length === 0 && <Nothing title="Никого нет" />}
          <ItemGroup className="gap-0.5">
            {people.map((p) => {
              const lastMsg = last.get(p.id);
              return (
                <Item key={p.id} asChild size="sm" variant={p.id === c?.id ? 'muted' : 'default'} className="items-start">
                  <button type="button" data-selected={p.id === c?.id} onClick={() => onSelect(p.id)}>
                    <ItemMedia>
                      <Avatar>
                        <AvatarFallback>{initials(p.peer_name)}</AvatarFallback>
                        {p.attention && <AvatarBadge className="bg-destructive" />}
                      </Avatar>
                    </ItemMedia>
                    <ItemContent className="min-w-0 gap-0.5">
                      <ItemTitle className="flex-wrap">
                        {p.peer_name}{drafts.has(p.id) && <Badge variant="secondary">черновик</Badge>}
                        {p.channel === 'account' && <Badge variant="outline" title="Пишем с этого аккаунта"><SendIcon />{accountLabel(p.account_id, feed.accounts)}</Badge>}
                        {typing.filter((t) => t.conversation_id === p.id).map((t) => (
                          <Badge key={t.who} variant="outline" title={typingText(t)}>{t.who === 'agent' ? <BotIcon /> : <PencilLineIcon />}{t.who === 'agent' ? 'пишет' : 'печатает'}</Badge>
                        ))}
                      </ItemTitle>
                      <ItemDescription className="line-clamp-1">{lastMsg?.direction === 'out' && 'Мы: '}{lastMsg?.text ?? drafts.get(p.id)?.text}</ItemDescription>
                      <ItemDescription className="line-clamp-1">{person(p)} · {leads(p)}</ItemDescription>
                    </ItemContent>
                    <ItemDescription>{time(p.last_message_at)}</ItemDescription>
                  </button>
                </Item>
              );
            })}
          </ItemGroup>
        </div>
      </aside>

      <section data-pane className="flex min-h-0 min-w-0 flex-col md:col-span-2 xl:col-span-3">
        {!c && <div className="m-auto"><Hint>Выберите человека слева.</Hint></div>}
        {c && (
          <>
            <header className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5">
              <Avatar size="lg"><AvatarFallback>{initials(c.peer_name)}</AvatarFallback></Avatar>
              <div className="min-w-0 flex-1 basis-48">
                <Item size="xs" className="p-0">
                  <ItemContent>
                    <ItemTitle>{c.peer_name} {c.peer_username && <TelegramLink username={c.peer_username} />}</ItemTitle>
                    <ItemDescription className="line-clamp-1">{person(c)} · пишет {via(c, feed.accounts)} · {leads(c)}</ItemDescription>
                  </ItemContent>
                </Item>
              </div>
              <div className="flex gap-2">
                {c.attention && <Button size="sm" variant="outline" onClick={() => done(c)}><CheckIcon />Готово <Kbd className="hidden xl:inline-flex">D</Kbd></Button>}
                <Button size="sm" variant="outline" onClick={() => toggleMode(c)}>
                  {c.mode === 'agent' ? <><HandIcon />Взять на себя</> : <><BotIcon />Вернуть агенту</>} <Kbd className="hidden xl:inline-flex">T</Kbd>
                </Button>
                <Button size="sm" variant="ghost" onClick={() => toggleHidden(c)}>
                  {c.hidden_at ? <><EyeIcon />Вернуть в список</> : <><EyeOffIcon />Скрыть</>} <Kbd className="hidden xl:inline-flex">H</Kbd>
                </Button>
              </div>
              {c.attention && (
                <Alert><CircleAlertIcon /><AlertDescription>Ждёт вас: {c.attention}</AlertDescription></Alert>
              )}
              {c.hidden_at && (
                <Alert><EyeOffIcon /><AlertDescription>Скрыт {time(c.hidden_at)}: вернётся в список, когда человек напишет снова.</AlertDescription></Alert>
              )}
            </header>
            <Thread conversation={c} messages={thread} me={feed.me} accounts={feed.accounts} typing={typing.filter((t) => t.conversation_id === c.id)} />
            <div className="flex flex-col gap-2 px-4 pt-1 pb-4">
              {draft && (
                <Draft
                  draft={draft} text={edited[draft.id]} onEdit={(text) => setEdited({ ...edited, [draft.id]: text })}
                  onSave={(text) => saveDraft({ id: draft.id, text }, { onSuccess: () => setEdited(({ [draft.id]: _, ...rest }) => rest) })}
                  onSend={() => sendDraft({ id: draft.id, text: edited[draft.id], account_id: from(c).account })} onReject={() => rejectDraft(draft.id)} from={from(c)}
                />
              )}
              <Reply from={from(c)} onSend={(text, sent) => send({ id: c.id, text, account_id: from(c).account }, { onSuccess: sent })} />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
