// Переписка (docs/agents-inbox.md): запись всего, что люди пишут боту и что бот или мы отвечаем, и операции админки.
import { asc, desc, eq } from 'drizzle-orm';
import type { Conversation, ConversationUpdateInput, InboxFeed, Message, User } from '@yaswami/core';
import type { Db } from './db/client.ts';
import { conversations, messages, users } from './db/schema.ts';
import { AppError } from './services.ts';
import { settings } from './settings.ts';
import type { BotResult, Incoming } from './telegram.ts';
import { bot } from './telegram.ts';

const NO_TEXT = '[сообщение без текста]';
// ponytail: лента без страниц — последние 200 диалогов и сообщений; подгрузка старого — когда этого станет мало.
const FEED_LIMIT = 200;

interface Peer { id: number; name?: string; username?: string | null }

/** Дописывает сообщение в диалог с человеком; диалога ещё нет — заводит. `attention` не передан — не меняется. */
async function record(db: Db, peer: Peer, message: Pick<Message, 'direction' | 'author' | 'text' | 'status'>, attention?: string | null): Promise<Conversation> {
  const profile = peer.name ? { peer_name: peer.name, peer_username: peer.username ?? null } : {};
  const [conversation] = await db
    .insert(conversations)
    .values({ channel: 'bot', peer_id: peer.id, peer_name: peer.name ?? String(peer.id), peer_username: peer.username ?? null, attention })
    .onConflictDoUpdate({
      target: [conversations.channel, conversations.peer_id],
      set: { last_message_at: new Date(), ...profile, ...(attention === undefined ? {} : { attention }) },
    })
    .returning();
  await db.insert(messages).values({ conversation_id: conversation!.id, ...message });
  return conversation!;
}

export const recordIncoming = (db: Db, m: Incoming) =>
  record(db, { id: m.chatId, name: m.from.first_name, username: m.from.username }, { direction: 'in', author: 'user', text: m.text || NO_TEXT, status: 'received' });

export const setAttention = (db: Db, id: string, attention: string | null) => db.update(conversations).set({ attention }).where(eq(conversations.id, id));

/** Запись исходящего: её вызывает `bot.send` на каждое сообщение бота человеку — ответ, уведомление, наше из админки. */
export const logSent = (db: Db) => async (method: string, body: { chat_id: number; text?: unknown; caption?: unknown }, result: BotResult, author: string) => {
  // Виджет не прошёл — следом то же уходит обычным сообщением (notifications.ts); неудачную попытку не пишем.
  if (method === 'sendWidget' && !result.ok) return;
  const [user] = await db.select().from(users).where(eq(users.id, body.chat_id));
  const text = typeof body.text === 'string' ? body.text : typeof body.caption === 'string' ? body.caption : NO_TEXT;
  await record(db, { id: body.chat_id, name: user?.first_name, username: user?.username }, { direction: 'out', author, text, status: result.ok ? 'sent' : 'failed' });
};

export const isAdmin = (actor: User) => settings.adminIds.includes(actor.id);
export function requireAdmin(actor: User) {
  if (!isAdmin(actor)) throw new AppError('forbidden', 403);
}

export async function inboxFeed(db: Db, actor: User): Promise<InboxFeed> {
  return {
    me: actor.id,
    conversations: await db.select().from(conversations).orderBy(desc(conversations.last_message_at)).limit(FEED_LIMIT),
    messages: await db.select().from(messages).orderBy(desc(messages.created_at)).limit(FEED_LIMIT),
  };
}

export const inboxThread = (db: Db, id: string): Promise<Message[]> =>
  db.select().from(messages).where(eq(messages.conversation_id, id)).orderBy(asc(messages.created_at)).limit(500);

export async function conversationById(db: Db, id: string): Promise<Conversation> {
  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, id));
  if (!conversation) throw new AppError('not_found', 404);
  return conversation;
}

/**
 * Мы пишем человеку сами: сообщение уходит через бота, а диалог переходит к нам — бот в нём замолкает.
 * `author` — `admin:<telegram id>` из админки или `agent`, когда пишет агент через MCP.
 */
export async function inboxSend(db: Db, author: string, id: string, text: string): Promise<void> {
  const conversation = await conversationById(db, id);
  const result = await bot.send('sendMessage', { chat_id: conversation.peer_id, text }, author);
  await db.update(conversations).set({ mode: 'human', attention: null }).where(eq(conversations.id, id));
  // Сообщение уже в ленте с пометкой «не доставлено»; ошибка — чтобы админка сказала об этом сразу.
  if (!result.ok) throw new AppError('not_delivered', 409);
}

export async function inboxUpdate(db: Db, id: string, input: ConversationUpdateInput): Promise<Conversation> {
  await conversationById(db, id);
  const [conversation] = await db.update(conversations).set(input).where(eq(conversations.id, id)).returning();
  return conversation!;
}
