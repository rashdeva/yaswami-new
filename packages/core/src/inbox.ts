// Переписка: диалог с человеком и сообщения в нём (docs/agents-inbox.md). Формы ответа API админки.
import * as z from 'zod';

export interface Conversation {
  id: string;
  /** Через что идёт переписка: бот «Я с вами» или один из наших аккаунтов Telegram (`account_id`). */
  channel: 'bot' | 'account';
  account_id: string | null;
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
  /** `user` — человек, `bot` — автоматический ответ или уведомление, `admin:<telegram id>` — кто-то из нас, `agent` — агент через MCP, `agent:support` — роль поддержки. */
  author: string;
  text: string;
  /** `queued` — ждёт отправки с аккаунта: её делает сборщик, а не API. */
  status: 'received' | 'queued' | 'sent' | 'failed';
  created_at: Date;
}

/** Лента админки: последние диалоги и последние сообщения во всех диалогах, свежие первыми. */
export interface InboxFeed {
  me: number;
  conversations: Conversation[];
  messages: Message[];
  accounts: TgAccount[];
}

/**
 * Аккаунт Telegram, с которого мы пишем людям. Вход идёт по шагам: админка записывает номер, код и пароль,
 * сборщик (у него MTProto) выполняет шаг и меняет `status`. Сессия аккаунта наружу не отдаётся никогда.
 */
export interface TgAccount {
  id: string;
  label: string;
  phone: string;
  /** login_requested — ждём, пока сборщик запросит код; login_code / login_password — ждём ввода в админке. */
  status: 'login_requested' | 'login_code' | 'login_password' | 'active' | 'error';
  last_error: string | null;
  created_at: Date;
}

export const AccountCreateInput = z.object({ label: z.string().trim().min(1).max(40), phone: z.string().trim().regex(/^\+\d{7,15}$/) });
export type AccountCreateInput = z.infer<typeof AccountCreateInput>;

/** Шаг входа: код из Telegram или пароль двухэтапной проверки — что именно, определяет `status` аккаунта. */
export const AccountLoginInput = z.object({ secret: z.string().trim().min(1).max(200) });
export type AccountLoginInput = z.infer<typeof AccountLoginInput>;

/** Сборщик сообщает API о личном сообщении на аккаунте: входящем или нашем, написанном прямо из Telegram. */
export const AccountMessageInput = z.object({
  account_id: z.uuid(),
  peer: z.object({ id: z.number().int(), name: z.string().min(1).max(200), username: z.string().nullable() }),
  direction: z.enum(['in', 'out']),
  text: z.string().min(1).max(10_000),
});
export type AccountMessageInput = z.infer<typeof AccountMessageInput>;

export const InboxSendInput = z.object({ text: z.string().trim().min(1).max(4000) });
export type InboxSendInput = z.infer<typeof InboxSendInput>;

export const ConversationUpdateInput = z.object({ mode: z.enum(['agent', 'human']).optional(), attention: z.null().optional() });
export type ConversationUpdateInput = z.infer<typeof ConversationUpdateInput>;
