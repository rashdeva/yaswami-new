// Переписка (docs/agents-inbox.md): запись всего, что люди пишут боту и что бот или мы отвечаем, и операции админки.
import { createCipheriv, randomBytes } from 'node:crypto';
import { and, asc, count, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import type {
  AccountCreateInput, AccountMessageInput, AccountUpdateInput, AdminOverview, AgentKey, Conversation, ConversationUpdateInput, InboxConversation, InboxFeed, LeadInput, Message,
  TgAccount, User,
} from '@yaswami/core';
import { AGENTS, collectedPath, collectedWhen } from '@yaswami/core';
import type { Ctx } from './audit.ts';
import { audited } from './audit.ts';
import type { Db } from './db/client.ts';
import { collectedEvents, collectedEventSignups, conversations, hosts, messages, tgAccounts, users } from './db/schema.ts';
import { AppError, collectedSlug } from './services.ts';
import { settings } from './settings.ts';
import { host, hunter } from './support.ts';
import type { SupportTurn } from './support.ts';
import type { BotResult, Incoming } from './telegram.ts';
import { bot } from './telegram.ts';

const NO_TEXT = '[сообщение без текста]';
// ponytail: лента без страниц — последние 200 диалогов и сообщений; подгрузка старого — когда этого станет мало.
const FEED_LIMIT = 200;
// Время сообщений и диалогов ставит только база: входящие получают его по умолчанию (now()), и если исходящим ставить
// время из JS, часы API и базы расходятся на миллисекунды — ответ, пришедший позже, оказывается «раньше» нашего
// сообщения, и стадия «ответил» не наступает.
const dbNow = sql`now()`;

/** Собеседник. `account_id` — он пишет на наш аккаунт Telegram, а не боту. */
interface Peer { id: number; name?: string; username?: string | null; account_id?: string | null }

/**
 * Дописывает сообщение в диалог с человеком; диалога ещё нет — заводит. `attention` не передан — не меняется.
 * Входящее снимает скрытие: человек написал снова — диалог возвращается в список.
 */
async function record(db: Db, peer: Peer, message: Pick<Message, 'direction' | 'author' | 'text' | 'status'> & { meta?: Message['meta'] }, attention?: string | null): Promise<Conversation> {
  const profile = peer.name ? { peer_name: peer.name, peer_username: peer.username ?? null } : {};
  const [conversation] = await db
    .insert(conversations)
    .values({
      // account_id задан, пусть и пустой, — переписка идёт с аккаунта (пустой: аккаунт ещё не подключён).
      channel: peer.account_id === undefined ? 'bot' : 'account', account_id: peer.account_id,
      peer_id: peer.id, peer_name: peer.name ?? String(peer.id), peer_username: peer.username ?? null, attention,
    })
    .onConflictDoUpdate({
      target: [conversations.channel, conversations.peer_id],
      // Человек написал на другой наш аккаунт — дальше отвечаем с него.
      set: {
        last_message_at: dbNow, ...profile, ...(peer.account_id ? { account_id: peer.account_id } : {}), ...(attention === undefined ? {} : { attention }),
        ...(message.direction === 'in' ? { hidden_at: null } : {}),
      },
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
  const conversation = await record(db, peer, { direction: 'in', author: 'user', text: input.text, status: 'received' }, reason);
  await alertAdmins(conversation, reason);
  // Диалог начала роль host и мы его не забирали — она готовит черновик ответа. Сборщика ответом модели не задерживаем.
  if (settings.hostUrl && conversation.mode === 'agent') {
    const [started] = await db.select({ id: messages.id }).from(messages)
      .where(and(eq(messages.conversation_id, conversation.id), eq(messages.author, 'agent:host'))).limit(1);
    if (started) void draftHostReply(db, conversation).catch(console.error);
  }
}

const CONTACT_AGAIN_DAYS = 7;
const pitching = new Set<number>(); // организаторы, которым роль host прямо сейчас пишет первое сообщение

/** Этому человеку мы уже писали на днях или его черновик ещё ждёт — второй раз первыми не лезем. */
async function contactedRecently(db: Db, peerId: number): Promise<boolean> {
  const [known] = await db.select().from(conversations).where(and(eq(conversations.channel, 'account'), eq(conversations.peer_id, peerId)));
  if (!known) return false;
  const since = new Date(Date.now() - CONTACT_AGAIN_DAYS * 86_400_000);
  const [recent] = await db.select({ id: messages.id }).from(messages)
    .where(and(eq(messages.conversation_id, known.id), eq(messages.direction, 'out'), gt(messages.created_at, since))).limit(1);
  return !!recent;
}

/** Что сервис знает об организаторе: его события в каталоге и сколько человек нажали на них «Записаться». */
async function hostFacts(db: Db, username: string): Promise<string> {
  const rows = await db
    .select({ external_id: collectedEvents.external_id, event: collectedEvents.event, claimed: collectedEvents.claimed_event_id, signups: count(collectedEventSignups.user_id) })
    .from(collectedEvents)
    .leftJoin(collectedEventSignups, eq(collectedEventSignups.external_id, collectedEvents.external_id))
    .where(and(eq(collectedEvents.telegram_username, username), gt(collectedEvents.starts_at, new Date())))
    .groupBy(collectedEvents.external_id)
    .orderBy(asc(collectedEvents.starts_at))
    .limit(10);
  const app = bot.username ? `https://t.me/${bot.username}/${bot.appName}` : settings.publicUrl;
  const [profile] = await db.select({ user_id: hosts.user_id }).from(hosts).where(eq(hosts.username, username));
  return [
    // Цель роли — чтобы организатор вошёл в сервис. Вошёл — продавать больше нечего, только отвечать.
    ...(profile?.user_id ? ['Организатор уже вошёл в «Я с вами». Ничего не предлагай и не уговаривай: только отвечай на его вопросы.'] : []),
    'Данные сервиса об организаторе. События собраны из его открытых анонсов; «записались» — столько человек нажали «Записаться» в «Я с вами» (это интерес, места подтверждает он сам).',
    ...rows.map((r) => `- «${r.event.title}», ${collectedWhen(r.event.starts_at)} — записались: ${r.signups}${r.claimed ? ', событие уже подтверждено им' : ''}. Страница: ${settings.publicUrl}${collectedPath(collectedSlug(r.external_id))}`),
    `Как подтвердить событие: открыть приложение ${app}, там появится вопрос «Это ваше событие?» — нажать «Это моё». После этого гости отвечают «Пойду» в один тап, а организатор видит список, кто придёт, и может отправить приглашение в любой чат. Это бесплатно.`,
  ].join('\n');
}

/**
 * На событие организатора нажали «Записаться» — повод написать ему первым. Роль host пишет сообщение, оно ложится
 * черновиком в «Ждут вас»; отправляет человек, в личку с нашего аккаунта. Цель — чтобы организатор вошёл в сервис:
 * вошедшему, подтвердившему это событие и тому, кому писали на днях, не пишем.
 */
export async function recordHostLead(db: Db, externalId: string): Promise<void> {
  if (!settings.hostUrl) return;
  const [event] = await db.select().from(collectedEvents).where(eq(collectedEvents.external_id, externalId));
  if (!event?.telegram_username || event.claimed_event_id) return;
  // Профиль организатора собирает сборщик: без него не знаем, кому писать.
  const [profile] = await db.select().from(hosts).where(eq(hosts.username, event.telegram_username));
  // Пока роль пишет черновик, новые записи к тому же организатору её второй раз не зовут: каждый вызов модели платный.
  if (!profile || profile.user_id || pitching.has(profile.telegram_id) || (await contactedRecently(db, profile.telegram_id))) return;

  pitching.add(profile.telegram_id);
  const reply = await host.ask([
    { role: 'system', content: await hostFacts(db, profile.username) },
    { role: 'user', content: `Напиши первое сообщение организатору ${profile.name} (@${profile.username}). Повод: на его событие «${event.event.title}» через «Я с вами» записались люди.` },
  ]).finally(() => pitching.delete(profile.telegram_id));
  if (!reply?.text) return;

  const reason = 'Черновик организатору';
  const account = await activeAccount(db);
  const conversation = await record(
    db, { id: profile.telegram_id, name: profile.name, username: profile.username, account_id: account?.id ?? null },
    { direction: 'out', author: 'agent:host', text: reply.text, status: 'draft', meta: { reason: `На «${event.event.title}» через нас записались` } }, reason,
  );
  await alertAdmins(conversation, reason);
}

/**
 * Организатор вошёл в сервис: неотправленные черновики роли host с предложением войти больше не нужны.
 * Зовётся при входе (auth.ts); сам диалог остаётся, на вопросы роль по-прежнему отвечает.
 */
export async function dropHostPitch(db: Db, telegramId: number): Promise<void> {
  const dialogs = db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.channel, 'account'), eq(conversations.peer_id, telegramId)));
  const dropped = await db.delete(messages)
    .where(and(inArray(messages.conversation_id, dialogs), eq(messages.author, 'agent:host'), eq(messages.status, 'draft')))
    .returning({ conversation_id: messages.conversation_id });
  for (const { conversation_id } of dropped) await setAttention(db, conversation_id, null);
}

/** Организатор ответил на наше сообщение: роль host готовит черновик ответа. Прежний неотправленный черновик заменяется. */
async function draftHostReply(db: Db, conversation: Conversation): Promise<void> {
  const history = await supportHistory(db, conversation.id);
  const reply = await host.ask([{ role: 'system', content: await hostFacts(db, conversation.peer_username ?? '') }, ...history]);
  if (!reply) return;
  await db.delete(messages).where(and(eq(messages.conversation_id, conversation.id), eq(messages.status, 'draft')));
  if (reply.text) {
    await db.insert(messages).values({
      conversation_id: conversation.id, direction: 'out', author: 'agent:host', text: reply.text, status: 'draft',
      meta: { reason: reply.human ? `Ответ организатору; роль просит человека: ${reply.human}` : 'Ответ организатору' },
    });
  }
  await setAttention(db, conversation.id, reply.human ?? 'Черновик ответа организатору');
}

/**
 * Сборщик нашёл в чате вопрос «куда сходить». Роль hunter подбирает событие и пишет ответ — он ложится черновиком
 * в «Ждут вас»: сами мы людям в чатах не пишем, каждое такое сообщение отправляет человек.
 */
export async function recordLead(db: Db, lead: LeadInput): Promise<void> {
  if (!settings.hunterUrl) return;
  if (settings.hunterUserIds.length && !settings.hunterUserIds.includes(lead.author.id)) return;
  if (await contactedRecently(db, lead.author.id)) return;
  // Отвечать будем с аккаунта. Его ещё нет — черновик всё равно показываем: аккаунт подберётся при отправке.
  const account = await activeAccount(db);

  const before = lead.context.length ? `Перед этим в чате писали:\n${lead.context.map((t) => `- ${t}`).join('\n')}\n\n` : '';
  const text = await hunter.ask(`Чат: ${lead.chat}\n\n${before}Вопрос (${lead.author.name}):\n${lead.text}`);
  // В журнал — чтобы было видно, что охотник делает с найденными вопросами (сам текст вопроса не пишем).
  console.log(`охотник: ${lead.url} — ${text ? 'черновик' : 'пропустил или роль недоступна'}`);
  if (!text) return;

  const reason = 'Черновик ответа в чат';
  const peer = { ...lead.author, account_id: account?.id ?? null };
  const conversation = await record(db, peer, { direction: 'in', author: 'user', text: `[чат ${lead.chat}] ${lead.text}`, status: 'received' }, reason);
  await db.insert(messages).values({
    conversation_id: conversation.id, direction: 'out', author: 'agent:hunter', text, status: 'draft',
    meta: { reason: `Вопрос в чате ${lead.chat}`, source_url: lead.url, reply_to: { chat: lead.chat, message_id: lead.message_id } },
  });
  await alertAdmins(conversation, reason);
}

const activeAccount = async (db: Db) =>
  (await db.select({ id: tgAccounts.id }).from(tgAccounts).where(eq(tgAccounts.status, 'active')).orderBy(asc(tgAccounts.created_at)).limit(1))[0];

async function draftById(db: Db, id: string): Promise<Message> {
  const [message] = await db.select().from(messages).where(eq(messages.id, id));
  if (!message) throw new AppError('not_found', 404);
  if (message.status !== 'draft') throw new AppError('not_draft', 409);
  return message;
}

/** Мы утвердили черновик агента: он встаёт в очередь на отправку, с нашим текстом, если мы его поправили. Не отменяется: уйдёт в Telegram. */
export const sendDraft = (db: Db, ctx: Ctx, id: string, text?: string) =>
  audited(db, ctx, { action: 'admin_drafts_send', entity: 'message', id, input: { text }, undoable: false }, async (db) => {
    const draft = await draftById(db, id);
    // Черновик появился, когда аккаунта ещё не было, — отправляем с первого подключённого.
    const conversation = await conversationById(db, draft.conversation_id);
    if (conversation.channel === 'account' && !conversation.account_id) {
      const account = await activeAccount(db);
      if (!account) throw new AppError('no_account', 409);
      await db.update(conversations).set({ account_id: account.id }).where(eq(conversations.id, conversation.id));
    }
    await db.update(messages).set({ status: 'queued', created_at: dbNow, ...(text ? { text } : {}) }).where(eq(messages.id, id));
    await db.update(conversations).set({ attention: null, last_message_at: dbNow }).where(eq(conversations.id, draft.conversation_id));
  });

/** Поправить текст черновика, не отправляя его. */
export const updateDraft = (db: Db, ctx: Ctx, id: string, text: string): Promise<Message> =>
  audited(db, ctx, { action: 'admin_drafts_update', entity: 'message', id, input: { text } }, async (db) => {
    await draftById(db, id);
    const [message] = await db.update(messages).set({ text }).where(eq(messages.id, id)).returning();
    return message!;
  });

/** Черновик отклонён: сообщение не уходит и из переписки пропадает. */
export const rejectDraft = (db: Db, ctx: Ctx, id: string) =>
  audited(db, ctx, { action: 'admin_drafts_reject', entity: 'message', id }, async (db) => {
    const draft = await draftById(db, id);
    await db.delete(messages).where(eq(messages.id, id));
    await db.update(conversations).set({ attention: null }).where(eq(conversations.id, draft.conversation_id));
  });

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

/**
 * Сообщает нам в Telegram, что диалог ждёт человека. Пишет командный бот (там же оператор Hermes, ему можно сразу
 * сказать, что ответить), без его токена — бот «Я с вами». Кто не открывал этого бота — не получит.
 */
export async function alertAdmins(conversation: Conversation, reason: string): Promise<void> {
  const text = `${conversation.peer_name}${conversation.peer_username ? ` (@${conversation.peer_username})` : ''} ждёт человека: ${reason}\n${settings.publicUrl}/admin/?c=${conversation.id}`; // сразу открывает этот диалог в «Людях»
  // Админу, который сам и есть собеседник (проверяет бота), не пишем: оповещение упало бы в тот же чат.
  const admins = settings.adminIds.filter((chat_id) => chat_id !== conversation.peer_id);
  const token = settings.teamBotToken;
  // ponytail: в командный бот — прямой вызов без очереди bot.send: оповещений мало, лимиты Telegram не грозят.
  const send = (chat_id: number) => token
    ? fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id, text }), signal: AbortSignal.timeout(10_000) })
      .then((res) => res.ok || console.error(`оповещение ${chat_id}: HTTP ${res.status}`), console.error)
    : bot.send('sendMessage', { chat_id, text }, 'alert');
  await Promise.all(admins.map(send));
}

/** Последние сообщения диалога в виде, который понимает роль поддержки: человек — user, всё наше — assistant. */
export async function supportHistory(db: Db, id: string): Promise<SupportTurn[]> {
  const rows = await db.select().from(messages).where(eq(messages.conversation_id, id)).orderBy(desc(messages.created_at)).limit(20);
  return rows.reverse().filter((m) => m.status !== 'failed' && m.status !== 'draft').map((m) => ({ role: m.direction === 'in' ? 'user' : 'assistant', content: m.text }));
}

export const isAdmin = (actor: User) => settings.adminIds.includes(actor.id);
export function requireAdmin(actor: User) {
  if (!isAdmin(actor)) throw new AppError('forbidden', 403);
}

/** Кто собеседник и на каком он шаге: по профилям организаторов, пользователям сервиса и самой переписке. */
async function withStages(db: Db, rows: Conversation[]): Promise<InboxConversation[]> {
  if (!rows.length) return [];
  const peers = rows.map((c) => c.peer_id);
  const organizers = new Map((await db.select({ id: hosts.telegram_id, user_id: hosts.user_id }).from(hosts).where(inArray(hosts.telegram_id, peers))).map((h) => [h.id, h.user_id]));
  const members = new Set((await db.select({ id: users.id }).from(users).where(inArray(users.id, peers))).map((u) => u.id));
  const ours = sql`${messages.direction} = 'out' and ${messages.status} in ('sent', 'queued')`;
  const facts = new Map((await db
    .select({
      id: messages.conversation_id,
      contacted: sql<boolean>`coalesce(bool_or(${ours}), false)`,
      draft: sql<boolean>`coalesce(bool_or(${messages.status} = 'draft'), false)`,
      // Ответил — написал нам после нашего первого сообщения.
      replied: sql<boolean>`coalesce(max(${messages.created_at}) filter (where ${messages.direction} = 'in') > min(${messages.created_at}) filter (where ${ours}), false)`,
      // Автор-агент: `agent:<роль>`, у оператора (пишет через MCP) — просто `agent`.
      agent: sql<string | null>`max(${messages.author}) filter (where ${messages.author} like 'agent%')`,
    })
    .from(messages).where(inArray(messages.conversation_id, rows.map((c) => c.id))).groupBy(messages.conversation_id)).map((f) => [f.id, f]));
  return rows.map((c) => {
    const f = facts.get(c.id);
    const organizer = organizers.has(c.peer_id);
    // Организатор «в сервисе», когда вошёл сам; гость из чата — когда появился среди пользователей.
    const joined = organizer ? organizers.get(c.peer_id) != null : c.channel === 'account' && members.has(c.peer_id);
    const stage = joined ? 'joined' : c.channel === 'bot' ? 'bot' : f?.replied ? 'replied' : f?.contacted ? 'contacted' : f?.draft ? 'draft' : 'wrote_us';
    return { ...c, kind: organizer ? 'organizer' : 'guest', stage, agent: agentKey(f?.agent) };
  });
}

const agentKey = (author: string | null | undefined): AgentKey | null => {
  if (!author) return null;
  const role = author.split(':')[1] ?? 'operator';
  return role in AGENTS ? (role as AgentKey) : null;
};

/** Разделы «Агенты» и «Организаторы» админки: что сделал каждый агент и кто такие организаторы каталога. */
export async function adminOverview(db: Db): Promise<AdminOverview> {
  const ours = sql`${messages.status} in ('sent', 'queued')`;
  const stats = await db
    .select({
      author: messages.author,
      conversations: sql<number>`count(distinct ${messages.conversation_id})::int`,
      drafts: sql<number>`(count(*) filter (where ${messages.status} = 'draft'))::int`,
      sent: sql<number>`(count(*) filter (where ${ours}))::int`,
      sent_today: sql<number>`(count(*) filter (where ${ours} and ${messages.created_at} > now() - interval '24 hours'))::int`,
    })
    .from(messages).where(sql`${messages.author} like 'agent%'`).groupBy(messages.author);
  const enabled: Record<AgentKey, boolean> = { support: !!settings.supportUrl, hunter: !!settings.hunterUrl, host: !!settings.hostUrl, operator: true };
  const agents = (Object.keys(AGENTS) as AgentKey[]).map((key) => {
    const row = stats.find((r) => agentKey(r.author) === key);
    return { key, enabled: enabled[key], conversations: row?.conversations ?? 0, drafts: row?.drafts ?? 0, sent: row?.sent ?? 0, sent_today: row?.sent_today ?? 0 };
  });

  // ponytail: до 300 организаторов одним списком; постраничная выдача и поиск на сервере — когда их станет больше.
  const profiles = await db.select().from(hosts).orderBy(asc(hosts.name)).limit(300);
  const activity = new Map((await db
    .select({
      username: collectedEvents.telegram_username,
      events: sql<number>`count(distinct ${collectedEvents.external_id})::int`,
      signups: sql<number>`count(${collectedEventSignups.user_id})::int`,
    })
    .from(collectedEvents)
    .leftJoin(collectedEventSignups, eq(collectedEventSignups.external_id, collectedEvents.external_id))
    .where(gt(collectedEvents.starts_at, new Date())).groupBy(collectedEvents.telegram_username)).map((r) => [r.username, r]));
  const ids = profiles.map((h) => h.telegram_id);
  const dialogs = ids.length
    ? await withStages(db, await db.select().from(conversations).where(and(eq(conversations.channel, 'account'), inArray(conversations.peer_id, ids))))
    : [];
  return {
    agents,
    hosts: profiles.map((h) => {
      const dialog = dialogs.find((c) => c.peer_id === h.telegram_id);
      return {
        telegram_id: h.telegram_id, name: h.name, username: h.username, channel: h.channel, summary: h.summary, registered: h.user_id != null,
        events: activity.get(h.username)?.events ?? 0, signups: activity.get(h.username)?.signups ?? 0,
        conversation_id: dialog?.id ?? null, stage: dialog?.stage ?? null,
      };
    }),
  };
}

export async function inboxFeed(db: Db, actor: User): Promise<InboxFeed> {
  return {
    me: actor.id,
    conversations: await withStages(db, await db.select().from(conversations).orderBy(desc(conversations.last_message_at)).limit(FEED_LIMIT)),
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
export const createAccount = (db: Db, ctx: Ctx, input: AccountCreateInput): Promise<TgAccount> =>
  audited(db, ctx, { action: 'admin_accounts_create', entity: 'account', id: (a) => a.id, input }, async (db) => {
    const [account] = await db.insert(tgAccounts).values(input).onConflictDoNothing().returning(accountFields);
    if (!account) throw new AppError('phone_taken', 409);
    return account;
  });

export const updateAccount = (db: Db, ctx: Ctx, id: string, input: AccountUpdateInput): Promise<TgAccount> =>
  audited(db, ctx, { action: 'admin_accounts_update', entity: 'account', id, input }, async (db) => {
    const [account] = await db.update(tgAccounts).set(input).where(eq(tgAccounts.id, id)).returning(accountFields);
    if (!account) throw new AppError('not_found', 404);
    return account;
  });

/** Тот же формат, что у сборщика (apps/collector/src/sender.mjs, seal/unseal): AES-256-GCM, iv.tag.body в base64. */
function seal(key: string, text: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString('base64')).join('.');
}

/**
 * Шаг входа: код или пароль. Сборщик заберёт значение, выполнит шаг и сотрёт его. В журнал — без секрета; не
 * отменяется: шаг входа уже ушёл в Telegram.
 */
export const submitAccountLogin = (db: Db, ctx: Ctx, id: string, secret: string) =>
  audited(db, ctx, { action: 'admin_accounts_login', entity: 'account', id, input: {}, undoable: false }, async (db) => {
    const [account] = await db.select(accountFields).from(tgAccounts).where(eq(tgAccounts.id, id));
    if (!account) throw new AppError('not_found', 404);
    if (account.status !== 'login_code' && account.status !== 'login_password') throw new AppError('not_expected', 409);
    await db.update(tgAccounts).set({ login: settings.accountsKey ? { sealed: seal(settings.accountsKey, secret) } : { secret }, last_error: null }).where(eq(tgAccounts.id, id));
  });

/**
 * Удаляет аккаунт вместе с сессией. Его диалоги остаются в истории, но писать в них будет не с чего. Не отменяется:
 * сессии в журнале нет, вернуть аккаунт можно только новым входом.
 */
export const deleteAccount = (db: Db, ctx: Ctx, id: string) =>
  audited(db, ctx, { action: 'admin_accounts_delete', entity: 'account', id, undoable: false }, async (db) => {
    const gone = await db.delete(tgAccounts).where(eq(tgAccounts.id, id)).returning({ id: tgAccounts.id });
    if (!gone.length) throw new AppError('not_found', 404);
  });

export const inboxThread = (db: Db, id: string): Promise<Message[]> =>
  db.select().from(messages).where(eq(messages.conversation_id, id)).orderBy(asc(messages.created_at)).limit(500);

export async function conversationById(db: Db, id: string): Promise<Conversation> {
  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, id));
  if (!conversation) throw new AppError('not_found', 404);
  return conversation;
}

/**
 * Мы пишем человеку сами: сообщение уходит через бота, а диалог переходит к нам — бот в нём замолкает.
 * Автор — `admin:<telegram id>` из админки или `agent`, когда пишет агент через MCP. Не отменяется: ушло в Telegram.
 */
export const inboxSend = (db: Db, ctx: Ctx, id: string, text: string) =>
  audited(db, ctx, { action: 'admin_messages_send', entity: 'conversation', id, input: { text }, undoable: false }, async (db) => {
    const author = ctx.via === 'admin' ? `admin:${ctx.actor.id}` : 'agent';
    const conversation = await conversationById(db, id);
    if (conversation.channel === 'account') {
      // С аккаунта отправляет сборщик: кладём сообщение в очередь, он заберёт его в течение нескольких секунд.
      if (!conversation.account_id) throw new AppError('account_gone', 409);
      await db.insert(messages).values({ conversation_id: id, direction: 'out', author, text, status: 'queued' });
      await db.update(conversations).set({ mode: 'human', attention: null, last_message_at: dbNow }).where(eq(conversations.id, id));
      return;
    }
    const result = await bot.send('sendMessage', { chat_id: conversation.peer_id, text }, author);
    await db.update(conversations).set({ mode: 'human', attention: null }).where(eq(conversations.id, id));
    // Сообщение уже в ленте с пометкой «не доставлено» (его пишет bot.log мимо этой транзакции); ошибка — чтобы
    // админка сказала об этом сразу.
    if (!result.ok) throw new AppError('not_delivered', 409);
  });

/** Режим, «готово» и скрытие диалога. Скрытый больше не ждёт нас: отвечать ему мы не собираемся. */
export const inboxUpdate = (db: Db, ctx: Ctx, id: string, input: ConversationUpdateInput): Promise<Conversation> =>
  audited(db, ctx, { action: 'admin_conversations_update', entity: 'conversation', id, input }, async (db) => {
    await conversationById(db, id);
    const { is_hidden, ...rest } = input;
    const hide = is_hidden === undefined ? {} : is_hidden ? { hidden_at: dbNow, attention: null } : { hidden_at: null };
    const [conversation] = await db.update(conversations).set({ ...rest, ...hide }).where(eq(conversations.id, id)).returning();
    return conversation!;
  });
