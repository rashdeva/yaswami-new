// Переписка с человеком на компонентах чата shadcn: message-scroller, message, bubble.
import { ArrowDownIcon } from 'lucide-react';
import { useEffect } from 'react';
import type { Conv, Msg } from '@/api';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Message, MessageContent, MessageFooter } from '@/components/ui/message';
import {
  MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport, useMessageScroller,
} from '@/components/ui/message-scroller';
import { kind, statusText, who } from '@/lib/inbox';

const BUBBLE = { user: 'secondary', bot: 'outline', agent: 'outline', admin: 'default' } as const;

/** Новое сообщение в открытой переписке — прокручиваем к нему. */
function Follow({ count }: { count: number }) {
  const { scrollToEnd } = useMessageScroller();
  useEffect(() => void scrollToEnd(), [count]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

interface Props {
  conversation: Conv;
  messages: Msg[];
  /** Наш Telegram id — чтобы подписать свои сообщения «Вы». */
  me: number;
  /** Через что идёт диалог: «боту» или «аккаунт …». */
  through: string;
}

export function Thread({ conversation, messages, me, through }: Props) {
  const sent = messages.filter((m) => m.status !== 'draft'); // черновик показывается отдельно, с кнопками
  return (
    <MessageScrollerProvider key={conversation.id}>
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport>
          <MessageScrollerContent className="gap-3 p-4">
            {sent.map((m) => {
              const align = m.direction === 'in' ? 'start' : 'end';
              return (
                <MessageScrollerItem key={m.id} messageId={m.id}>
                  <Message align={align}>
                    <MessageContent className="gap-1">
                      <Bubble variant={BUBBLE[kind(m)]} align={align}>
                        <BubbleContent className="whitespace-pre-wrap">{m.text}</BubbleContent>
                      </Bubble>
                      <MessageFooter className={m.status === 'failed' ? 'text-destructive' : ''}>{who(conversation, m, me, through)} · {statusText(m)}</MessageFooter>
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
      <Follow count={sent.length} />
    </MessageScrollerProvider>
  );
}
