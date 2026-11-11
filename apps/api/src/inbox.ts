// Переписка (docs/agents-inbox.md): запись всего, что люди пишут боту и что бот или мы отвечаем, и операции админки.
import { asc, desc, eq } from 'drizzle-orm';
import type { AccountCreateInput, AccountMessageInput, Conversation, ConversationUpdateInput, InboxFeed, Message, TgAccount, User } from '@yaswami/core';
import type { Db } from './db/client.ts';
import { conversations, messages, tgAccounts, users } from './db/schema.ts';
import { AppError } from './services.ts';
import { settings } from './settings.ts';
import type { SupportTurn } from './support.ts';
import type { BotResult, Incoming } from './telegram.ts';
import { bot } from './telegram.ts';

const NO_TEXT = '[сообщение без текста]';
// ponytail: лента без страниц — последние 200 диалогов и сообщений; подгрузка старого — когда этого станет мало.
const FEED_LIMIT = 200;

/** Собеседник. `account_id` — он пишет на наш аккаунт Telegram, а не боту. */
interface Peer { id: number; name?: string; username?: string | null; account_id?: string }

/** Дописывает сообщение в диалог с человеком; диалога ещё нет — заводит. `attention` не передан — не меняется. */
async function record(db: Db, peer: Peer, message: Pick<Message, 'direction' | 'author' | 'text' | 'status'>, attention?: string | null): Promise<Conversation> {
  const profile = peer.name ? { peer_name: peer.name, peer_username: peer.username ?? null } : {};
  const [conversation] = await db
    .insert(conversations)
    .values({
      channel: peer.account_id ? 'account' : 'bot', account_id: peer.account_id,
      peer_id: peer.id, peer_name: peer.name ?? String(peer.id), peer_username: peer.username ?? null, attention,
    })
    .onConflictDoUpdate({
      target: [conversations.channel, conversations.peer_id],
      // Человек написал на другой наш аккаунт — дальше отвечаем с него.
      set: { last_message_at: new Date(), ...profile, ...(peer.account_id ? { account_id: peer.account_id } : {}), ...(attention === undefined ? {} : { attention }) },
    })
    .returning();
  await db.insert(messages).values({ conversation_id: conversation!.id, ...message });
  return conversation!;
}

export const recordIncoming = (db: Db, m: Incoming) =>
  record(db, { id: m.chatId, name: m.from.first_name, username: m.from.username }, { direction: 'in', author: 'user', text: m.text || NO_TEXT, status: 'received' });

/**
 * Личное сообщение на нашем аккаунте Telegram — о нём сообщает сборщик. Входящее ждёт нас: агента на аккаунтах пока нет.
 * Исходящее — мы ответили прямо из Telegram: диалог ведём мы.
 */
export async function recordAccountMessage(db: Db, input: AccountMessageInput): Promise<void> {
  const peer = { ...input.peer, account_id: input.account_id };
  if (input.direction === 'out') {
    const conversation = await record(db, peer, { direction: 'out', author: 'admin', text: input.text, status: 'sent' }, null);
    await db.update(conversations).set({ mode: 'human' }).where(eq(conversations.id, conversation.id));
    return;
  }
  const reason = 'Написал на аккаунт';
  await alertAdmins(await record(db, peer, { direction: 'in', author: 'user', text: input.text, status: 'received' }, reason), reason);
}

export const setAttention = (db: Db, id: string, attention: string | null) => db.update(conversations).set({ attention }).where(eq(conversations.id, id));

/** Запись исходящего: её вызывает `bot.send` на каждое сообщение бота человеку — ответ, уведомление, наше из админки. */
export const logSent = (db: Db) => async (method: string, body: { chat_id: number; text?: unknown; caption?: unknown }, result: BotResult, author: string) => {
  // Виджет не прошёл — следом то же уходит обычным сообщением (notifications.ts); неудачную попытку не пишем.
  // Оповещение нам самим (alertAdmins) — не переписка с человеком.
  if ((method === 'sendWidget' && !result.ok) || author === 'alert') return;
  const [user] = await db.select().from(users).where(eq(users.id, body.chat_id));
  const text = typeof body.text === 'string' ? body.text : typeof body.caption === 'string' ? body.caption : NO_TEXT;
  await record(db, { id: body.chat_id, name: user?.first_name, username: user?.username }, { direction: 'out', author, text, status: result.ok ? 'sent' : 'failed' });
};

/** Сообщает нам в Telegram, что диалог ждёт человека. Пишет бот «Я с вами»; кто не открывал бота — не получит. */
export async function alertAdmins(conversation: Conversation, reason: string): Promise<void> {
  const text = `${conversation.peer_name}${conversation.peer_username ? ` (@${conversation.peer_username})` : ''} ждёт человека: ${reason}\n${settings.publicUrl}/admin`;
  // Админу, который сам и есть собеседник (проверяет бота), не пишем: оповещение упало бы в тот же чат.
  const admins = settings.adminIds.filter((chat_id) => chat_id !== conversation.peer_id);
  await Promise.all(admins.map((chat_id) => bot.send('sendMessage', { chat_id, text }, 'alert')));
}

/** Последние сообщения диалога в виде, который понимает роль поддержки: человек — user, всё наше — assistant. */
export async function supportHistory(db: Db, id: string): Promise<SupportTurn[]> {
  const rows = await db.select().from(messages).where(eq(messages.conversation_id, id)).orderBy(desc(messages.created_at)).limit(20);
  return rows.reverse().filter((m) => m.status !== 'failed').map((m) => ({ role: m.direction === 'in' ? 'user' : 'assistant', content: m.text }));
}

export const isAdmin = (actor: User) => settings.adminIds.includes(actor.id);
export function requireAdmin(actor: User) {
  if (!isAdmin(actor)) throw new AppError('forbidden', 403);
}

export async function inboxFeed(db: Db, actor: User): Promise<InboxFeed> {
  return {
    me: actor.id,
    conversations: await db.select().from(conversations).orderBy(desc(conversations.last_message_at)).limit(FEED_LIMIT),
    messages: await db.select().from(messages).orderBy(desc(messages.created_at)).limit(FEED_LIMIT),
    accounts: await listAccounts(db),
  };
}

// Наружу — без сессии и без кода с паролем: их видит только сборщик.
const accountFields = {
  id: tgAccounts.id, label: tgAccounts.label, phone: tgAccounts.phone, status: tgAccounts.status,
  last_error: tgAccounts.last_error, created_at: tgAccounts.created_at,
};
export const listAccounts = (db: Db): Promise<TgAccount[]> => db.select(accountFields).from(tgAccounts).orderBy(asc(tgAccounts.created_at));

/** Новый аккаунт: сборщик увидит строку и запросит у Telegram код на этот номер. */
export async function createAccount(db: Db, input: AccountCreateInput): Promise<TgAccount> {
  const [account] = await db.insert(tgAccounts).values(input).onConflictDoNothing().returning(accountFields);
  if (!account) throw new AppError('phone_taken', 409);
  return account;
}

/** Шаг входа: код или пароль. Сборщик заберёт значение, выполнит шаг и сотрёт его. */
export async function submitAccountLogin(db: Db, id: string, secret: string): Promise<void> {
  const [account] = await db.select(accountFields).from(tgAccounts).where(eq(tgAccounts.id, id));
  if (!account) throw new AppError('not_found', 404);
  if (account.status !== 'login_code' && account.status !== 'login_password') throw new AppError('not_expected', 409);
  await db.update(tgAccounts).set({ login: { secret }, last_error: null }).where(eq(tgAccounts.id, id));
}

/** Удаляет аккаунт вместе с сессией. Его диалоги остаются в истории, но писать в них будет не с чего. */
export const deleteAccount = (db: Db, id: string) => db.delete(tgAccounts).where(eq(tgAccounts.id, id));

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
  if (conversation.channel === 'account') {
    // С аккаунта отправляет сборщик: кладём сообщение в очередь, он заберёт его в течение нескольких секунд.
    if (!conversation.account_id) throw new AppError('account_gone', 409);
    await db.insert(messages).values({ conversation_id: id, direction: 'out', author, text, status: 'queued' });
    await db.update(conversations).set({ mode: 'human', attention: null, last_message_at: new Date() }).where(eq(conversations.id, id));
    return;
  }
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
