// «Лента»: сверху диалоги, которые ждут нас, ниже — живой поток всех сообщений; переписка выезжает сбоку.
import { useState } from 'react';
import { Draft } from '@/components/Draft';
import { Reply } from '@/components/Reply';
import { Thread } from '@/components/Thread';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { isFresh, useConversationActions, useFeed, useThread } from '@/hooks/useInbox';
import { useInboxKeys } from '@/hooks/useInboxKeys';
import { draftsOf, eventsOf, feedRows, kind, person, pick, time, via, who } from '@/lib/inbox';

// Полоска слева у сообщения: кто написал.
const EDGE = { user: 'border-l-border', bot: 'border-l-muted-foreground/50', agent: 'border-l-muted-foreground/50', admin: 'border-l-primary' } as const;
const SELECTED = 'data-[selected=true]:bg-muted data-[selected=true]:ring-2 data-[selected=true]:ring-ring';

export function FeedScreen() {
  const feed = useFeed();
  const [selected, setSelected] = useState(''); // ключ строки: c:<диалог> или m:<сообщение>
  const [drawer, setDrawer] = useState(false);
  const [edited, setEdited] = useState<Record<string, string>>({}); // наши правки черновиков: id сообщения → текст
  const { send, sendDraft, saveDraft, rejectDraft } = useConversationActions();

  const pinned = feed.conversations.filter((c) => c.attention);
  const events = eventsOf(feed);
  const drafts = draftsOf(feed);
  const rows = feedRows(feed);
  const { at, cur } = pick(rows, selected);
  const draft = cur && drafts.get(cur.c.id);
  const open = drawer && !!cur;
  const thread = useThread(open ? cur.c.id : undefined);
  useInboxKeys({
    rows, at, onSelect: setSelected, draft, draftText: draft && edited[draft.id],
    scope: '[data-selected=true]',
    onToggleThread: () => setDrawer(!drawer), onEscape: () => setDrawer(false),
  });

  return (
    <div className="h-full overflow-y-auto p-5 pb-16">
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        <h2 className="flex items-center gap-2 font-medium">Ждут вас <Badge>{pinned.length}</Badge></h2>
        {pinned.length === 0 && <p className="text-xs text-muted-foreground">Никто не ждёт. Ниже видно всё, что происходит.</p>}
        {pinned.map((c) => {
          const pending = drafts.get(c.id);
          return (
            <Card key={c.id} size="sm" data-selected={cur?.key === `c:${c.id}`} onClick={() => setSelected(`c:${c.id}`)} className={`scroll-my-24 border-l-4 border-l-orange-600 ${SELECTED}`}>
              <CardContent className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span>
                    <strong>{c.peer_name}</strong> {c.peer_username && <span className="text-xs text-muted-foreground">@{c.peer_username}</span>}{' '}
                    <span className="text-xs text-muted-foreground">{person(c)}</span>{' '}
                    {c.mode === 'human' && <Badge variant="secondary">ведёте вы</Badge>}
                  </span>
                  <Badge variant="destructive" className="h-auto whitespace-normal">{c.attention}</Badge>
                </div>
                {feed.messages.filter((m) => m.conversation_id === c.id && m.direction === 'in').slice(0, 2).reverse().map((m) => (
                  <div key={m.id} className="border-l-2 px-2.5 py-1 wrap-anywhere whitespace-pre-wrap">{m.text}</div>
                ))}
                {pending ? (
                  <Draft
                    draft={pending} text={edited[pending.id]} onEdit={(text) => setEdited({ ...edited, [pending.id]: text })}
                    onSave={(text) => saveDraft({ id: pending.id, text }, { onSuccess: () => setEdited(({ [pending.id]: _, ...rest }) => rest) })}
                    onSend={() => sendDraft({ id: pending.id, text: edited[pending.id] })} onReject={() => rejectDraft(pending.id)}
                  />
                ) : <Reply onSend={(text) => send({ id: c.id, text })} />}
              </CardContent>
            </Card>
          );
        })}

        <h2 className="mt-4 flex items-center gap-2 font-medium">Лента <Badge variant="outline" className="border-green-600/40 text-green-700 dark:text-green-400">идёт</Badge></h2>
        {events.length === 0 && <p className="text-xs text-muted-foreground">Пока никто не писал.</p>}
        {events.map(({ c, m }) => {
          const sel = cur?.key === `m:${m.id}`;
          return (
            <div
              key={m.id} data-selected={sel} onClick={() => setSelected(`m:${m.id}`)}
              className={`grid scroll-my-24 grid-cols-[52px_1fr] gap-2.5 rounded-lg border-l-[3px] px-3 py-2 text-sm ${EDGE[kind(m)]} ${SELECTED} ${isFresh(m.id) ? 'animate-fresh' : ''}`}
            >
              <span className="pt-0.5 text-xs text-muted-foreground">{time(m.created_at)}</span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {who(c, m, feed.me, via(c, feed.accounts))} {c.mode === 'human' && <Badge variant="secondary">ведёте вы</Badge>}
                  {m.status === 'queued' && <Badge variant="secondary">отправляется</Badge>}
                  {m.status === 'failed' && <Badge variant="destructive">не доставлено</Badge>}
                </div>
                <div className="wrap-anywhere whitespace-pre-wrap">{m.text}</div>
                {sel && <Reply className="mt-1.5" onSend={(text) => send({ id: c.id, text })} />}
              </div>
            </div>
          );
        })}
      </div>

      {/* Не модальная: лента за ней остаётся живой, выбор строки меняет переписку. Esc обрабатывает useInboxKeys. */}
      <Sheet open={open} onOpenChange={setDrawer} modal={false}>
        {cur && (
          <SheetContent className="w-full gap-0 data-[side=right]:sm:max-w-md" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
            <SheetHeader className="border-b">
              <SheetTitle>{cur.c.peer_name} {cur.c.peer_username && <span className="text-xs font-normal text-muted-foreground">@{cur.c.peer_username}</span>}</SheetTitle>
              <SheetDescription>{person(cur.c)} · {cur.c.mode === 'human' ? 'диалог ведёте вы' : 'отвечает агент'}</SheetDescription>
            </SheetHeader>
            <Thread conversation={cur.c} messages={thread} me={feed.me} through={via(cur.c, feed.accounts)} />
            <Reply className="border-t p-4" onSend={(text) => send({ id: cur.c.id, text })} />
          </SheetContent>
        )}
      </Sheet>
    </div>
  );
}
