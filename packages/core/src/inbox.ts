// Переписка: диалог с человеком и сообщения в нём (docs/agents-inbox.md). Формы ответа API админки.
import * as z from 'zod';

export interface Conversation {
  id: string;
  /** Через что идёт переписка. Пока только бот; аккаунты Telegram появятся вместе с отправкой от их имени. */
  channel: 'bot';
  peer_id: number; // id чата в Telegram
  peer_name: string;
  peer_username: string | null;
  /** Кто ведёт диалог: `human` — мы сами, бот и агенты в нём молчат. */
  mode: 'agent' | 'human';
  /** Почему диалог ждёт нас; null — не ждёт. */
  attention: string | null;
  last_message_at: Date;
}

export interface Message {
  id: string;
  conversation_id: string;
  direction: 'in' | 'out';
  /** `user` — человек, `bot` — автоматический ответ или уведомление, `admin:<telegram id>` — кто-то из нас. */
  author: string;
  text: string;
  status: 'received' | 'sent' | 'failed';
  created_at: Date;
}

/** Лента админки: последние диалоги и последние сообщения во всех диалогах, свежие первыми. */
export interface InboxFeed {
  me: number;
  conversations: Conversation[];
  messages: Message[];
}

export const InboxSendInput = z.object({ text: z.string().trim().min(1).max(4000) });
export type InboxSendInput = z.infer<typeof InboxSendInput>;

export const ConversationUpdateInput = z.object({ mode: z.enum(['agent', 'human']).optional(), attention: z.null().optional() });
export type ConversationUpdateInput = z.infer<typeof ConversationUpdateInput>;
