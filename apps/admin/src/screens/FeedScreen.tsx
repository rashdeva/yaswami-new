// «Лента»: сверху диалоги, которые ждут нас, ниже — живой поток всех сообщений; переписка выезжает сбоку.
import { useState } from 'react';
import { Draft } from '@/components/Draft';
import { Reply } from '@/components/Reply';
import { Thread } from '@/components/Thread';
import { Hint, Page } from '@/components/Page';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Marker, MarkerContent } from '@/components/ui/marker';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { isFresh, useConversationActions, useFeed, useSendFrom, useThread } from '@/hooks/useInbox';
import { useInboxKeys } from '@/hooks/useInboxKeys';
import { useTyping } from '@/hooks/useLive';
import { draftsOf, eventsOf, feedRows, initials, person, pick, time, via, visible, who } from '@/lib/inbox';


export function FeedScreen() {
  const feed = visible(useFeed());
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
  const typing = useTyping();
  const from = useSendFrom(feed.accounts);
  useInboxKeys({
    rows, at, onSelect: setSelected, draft, draftText: draft && edited[draft.id], account: cur && from(cur.c).account,
    scope: '[data-selected=true]',
    onToggleThread: () => setDrawer(!drawer), onEscape: () => setDrawer(false),
  });

  return (
    <Page title="Лента">
      <Marker variant="separator"><MarkerContent>Ждут вас · {pinned.length}</MarkerContent></Marker>
      {pinned.length === 0 && <Hint>Никто не ждёт. Ниже видно всё, что происходит.</Hint>}
      {pinned.map((c) => {
        const pending = drafts.get(c.id);
        const sel = cur?.key === `c:${c.id}`;
        return (
          <Card key={c.id} size="sm" data-selected={sel} onClick={() => setSelected(`c:${c.id}`)} className="scroll-my-24 data-[selected=true]:ring-2 data-[selected=true]:ring-ring">
            <CardHeader>
              <CardTitle>{c.peer_name} {c.mode === 'human' && <Badge variant="secondary">ведёте вы</Badge>}</CardTitle>
              <CardDescription>{c.peer_username && `@${c.peer_username} · `}{person(c)} · пишет {via(c, feed.accounts)}</CardDescription>
              <CardAction><Badge variant="destructive">{c.attention}</Badge></CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <ItemGroup className="gap-1">
                {feed.messages.filter((m) => m.conversation_id === c.id && m.direction === 'in').slice(0, 2).reverse().map((m) => (
                  <Item key={m.id} size="xs" variant="muted"><ItemContent><ItemDescription className="line-clamp-none whitespace-pre-wrap">{m.text}</ItemDescription></ItemContent></Item>
                ))}
              </ItemGroup>
              {pending ? (
                <Draft
                  draft={pending} text={edited[pending.id]} onEdit={(text) => setEdited({ ...edited, [pending.id]: text })}
                  onSave={(text) => saveDraft({ id: pending.id, text }, { onSuccess: () => setEdited(({ [pending.id]: _, ...rest }) => rest) })}
                  onSend={() => sendDraft({ id: pending.id, text: edited[pending.id], account_id: from(c).account })} onReject={() => rejectDraft(pending.id)} from={from(c)}
                />
              ) : <Reply from={from(c)} onSend={(text, sent) => send({ id: c.id, text, account_id: from(c).account }, { onSuccess: sent })} />}
            </CardContent>
          </Card>
        );
      })}

      <Marker variant="separator"><MarkerContent>Все сообщения</MarkerContent></Marker>
      {events.length === 0 && <Hint>Пока никто не писал.</Hint>}
      <ItemGroup className="gap-1">
        {events.map(({ c, m }) => {
          const sel = cur?.key === `m:${m.id}`;
          return (
            <Item
              key={m.id} data-selected={sel} variant={sel ? 'muted' : 'default'} onClick={() => setSelected(`m:${m.id}`)}
              className={`scroll-my-24 items-start ${isFresh(m.id) ? 'animate-fresh' : ''}`}
            >
              <ItemMedia><Avatar size="sm"><AvatarFallback>{initials(m.direction === 'in' ? c.peer_name : 'Я с вами')}</AvatarFallback></Avatar></ItemMedia>
              <ItemContent>
                <ItemTitle>
                  {who(c, m, feed.me, feed.accounts)}
                  {c.mode === 'human' && <Badge variant="secondary">ведёте вы</Badge>}
                  {(m.status === 'queued' || m.status === 'sending') && <Badge variant="secondary">отправляется</Badge>}
                  {m.status === 'failed' && <Badge variant="destructive">не доставлено</Badge>}
                </ItemTitle>
                <ItemDescription className="line-clamp-none whitespace-pre-wrap">{m.text}</ItemDescription>
                {sel && <Reply from={from(c)} onSend={(text, sent) => send({ id: c.id, text, account_id: from(c).account }, { onSuccess: sent })} />}
              </ItemContent>
              <ItemDescription>{time(m.created_at)}</ItemDescription>
            </Item>
          );
        })}
      </ItemGroup>

      {/* Не модальная: лента за ней остаётся живой, выбор строки меняет переписку. Esc обрабатывает useInboxKeys. */}
      <Sheet open={open} onOpenChange={setDrawer} modal={false}>
        {cur && (
          <SheetContent className="w-full gap-0 data-[side=right]:sm:max-w-md" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
            <SheetHeader className="border-b">
              <SheetTitle>{cur.c.peer_name}</SheetTitle>
              <SheetDescription>{cur.c.peer_username && `@${cur.c.peer_username} · `}{person(cur.c)} · пишет {via(cur.c, feed.accounts)} · {cur.c.mode === 'human' ? 'диалог ведёте вы' : 'отвечает агент'}</SheetDescription>
            </SheetHeader>
            <Thread conversation={cur.c} messages={thread} me={feed.me} accounts={feed.accounts} typing={typing.filter((t) => t.conversation_id === cur.c.id)} />
            <Reply className="p-4" from={from(cur.c)} onSend={(text, sent) => send({ id: cur.c.id, text, account_id: from(cur.c).account }, { onSuccess: sent })} />
          </SheetContent>
        )}
      </Sheet>
    </Page>
  );
}
