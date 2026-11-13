// Переписка с человеком на компонентах чата shadcn: message-scroller, message, bubble; дни разделены marker.
import { ArrowDownIcon } from 'lucide-react';
import { useEffect } from 'react';
import type { Account, Conv, Msg } from '@/api';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Marker, MarkerContent } from '@/components/ui/marker';
import { Message, MessageContent, MessageFooter } from '@/components/ui/message';
import {
  MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport, useMessageScroller,
} from '@/components/ui/message-scroller';
import type { Typing } from '@yaswami/core';
import { day, kind, statusText, typingText, who } from '@/lib/inbox';

const BUBBLE = { user: 'secondary', bot: 'outline', agent: 'outline', admin: 'default' } as const;

/** Новое сообщение или дописанный агентом текст в открытой переписке — прокручиваем к нему. */
function Follow({ at }: { at: string }) {
  const { scrollToEnd } = useMessageScroller();
  useEffect(() => void scrollToEnd(), [at]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

interface Props {
  conversation: Conv;
  messages: Msg[];
  /** Наш Telegram id — чтобы подписать свои сообщения «Вы». */
  me: number;
  /** Наши аккаунты: в подписи сообщения — тот, через который оно прошло. */
  accounts: Account[];
  /** Кто пишет прямо сейчас: агент — с текстом, который уже написал. */
  typing: Typing[];
}

export function Thread({ conversation, messages, me, accounts, typing }: Props) {
  const sent = messages.filter((m) => m.status !== 'draft'); // черновик показывается отдельно, с кнопками
  return (
    <MessageScrollerProvider key={conversation.id}>
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport>
          <MessageScrollerContent className="gap-3 p-4">
            {sent.map((m, i) => {
              const align = m.direction === 'in' ? 'start' : 'end';
              const label = day(m.created_at);
              return (
                <MessageScrollerItem key={m.id} messageId={m.id}>
                  {label !== (i > 0 && day(sent[i - 1]!.created_at)) && (
                    <Marker variant="separator"><MarkerContent>{label}</MarkerContent></Marker>
                  )}
                  <Message align={align}>
                    <MessageContent className="gap-1">
                      <Bubble variant={BUBBLE[kind(m)]} align={align}>
                        <BubbleContent className="whitespace-pre-wrap">{m.text}</BubbleContent>
                      </Bubble>
                      <MessageFooter className={m.status === 'failed' ? 'text-destructive' : ''}>{who(conversation, m, me, accounts)} · {statusText(m, true)}</MessageFooter>
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              );
            })}
            {typing.map((t) => {
              const align = t.who === 'user' ? 'start' : 'end';
              return (
                <MessageScrollerItem key={t.who} messageId={`typing-${t.who}`}>
                  <Message align={align}>
                    <MessageContent className="gap-1">
                      <Bubble variant={BUBBLE[t.who]} align={align}>
                        <BubbleContent className="whitespace-pre-wrap">{t.text || '…'}</BubbleContent>
                      </Bubble>
                      <MessageFooter>{typingText(t)}</MessageFooter>
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              );
            })}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton>
          <ArrowDownIcon />
          <span className="sr-only">К последнему сообщению</span>
        </MessageScrollerButton>
      </MessageScroller>
      <Follow at={`${sent.length}:${typing.map((t) => t.text?.length ?? 0).join()}`} />
    </MessageScrollerProvider>
  );
}
