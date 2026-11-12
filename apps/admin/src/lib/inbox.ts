// Чистые функции переписки: кто написал, кто ведёт диалог, выборки для «Людей» и «Ленты». Без React и сети.
import type { AgentKey, InboxConversation, InboxFeed, Message, Typing, Wire } from '@yaswami/core';
import { AGENTS, INBOX_STAGES } from '@yaswami/core';

type Conv = Wire<InboxConversation>;
type Msg = Wire<Message>;
type Feed = Wire<InboxFeed>;

export const time = (iso: string) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('ru', { day: 'numeric', month: 'short' });
};

/** Подпись дня над сообщениями: «Сегодня», «Вчера» или «12 ноября» (с годом, если не текущий). */
export function day(iso: string, now = new Date()) {
  const d = new Date(iso);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'Сегодня';
  if (d.toDateString() === yesterday.toDateString()) return 'Вчера';
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'long', ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) });
}

/** Буквы для аватара: первые буквы двух первых слов имени. */
export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]).join('').toUpperCase() || '?';

/** Какой агент написал сообщение: `agent:<роль>`, у оператора — просто `agent`. */
export const agentOf = (author: string): AgentKey | null => {
  if (!author.startsWith('agent')) return null;
  const role = author.split(':')[1] ?? 'operator';
  return role in AGENTS ? (role as AgentKey) : null;
};

/** Кто отправитель с нашей стороны: бот сам, один из агентов или человек из команды. */
export const sender = (m: Msg, me: number) => {
  const agent = agentOf(m.author);
  return m.author === 'bot' ? 'Бот (автоответ)' : agent ? `Агент «${AGENTS[agent].name}»` : m.author === `admin:${me}` ? 'Вы' : 'Человек из команды';
};

/** Через что идёт диалог: бот или наш аккаунт. */
export const via = (c: Conv, accounts: Feed['accounts']) =>
  c.channel === 'bot' ? 'боту' : `аккаунт «${accounts.find((a) => a.id === c.account_id)?.label ?? 'не подключён'}»`;

/** Подпись сообщения: кто кому. */
export const who = (c: Conv, m: Msg, me: number, through: string) =>
  m.direction === 'in' ? `${c.peer_name} → ${through}` : `${sender(m, me)} → ${c.peer_name}${c.channel === 'account' ? ` · ${through}` : ''}`;

/** Кто сейчас отвечает в диалоге. */
export const leads = (c: Conv) =>
  c.mode === 'human' ? 'ведёте вы' : c.agent ? `ведёт агент «${AGENTS[c.agent].name}»` : c.channel === 'bot' ? 'отвечает бот' : 'никто не ведёт';

export const kind = (m: Msg) => (m.direction === 'in' ? 'user' : m.author === 'bot' ? 'bot' : m.author.startsWith('agent') ? 'agent' : 'admin');

export const person = (c: Conv) => `${c.kind === 'organizer' ? 'Организатор' : 'Гость'} · ${INBOX_STAGES[c.stage]}`;

/** Состояние сообщения или когда оно пришло; `clock` — только время: день уже подписан разделителем в переписке. */
export const statusText = (m: Msg, clock = false) =>
  m.status === 'failed' ? 'не доставлено' : m.status === 'queued' ? 'отправляется' : m.status === 'draft' ? 'черновик, не отправлено'
    : clock ? new Date(m.created_at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) : time(m.created_at);

/** Скрытые диалоги видны только под фильтром «Скрытые»: вернуть руками. */
const shown = (c: Conv) => !c.hidden_at;

export type Filter = 'all' | 'waiting' | 'organizer' | 'guest' | 'hidden';
export const FILTERS: [Filter, string, (c: Conv) => boolean][] = [
  ['all', 'Все', shown],
  ['waiting', 'Ждут вас', (c) => shown(c) && !!c.attention],
  ['organizer', 'Организаторы', (c) => shown(c) && c.kind === 'organizer'],
  ['guest', 'Гости', (c) => shown(c) && c.kind === 'guest'],
  ['hidden', 'Скрытые', (c) => !shown(c)],
];

/** Лента без скрытых диалогов: их сообщения в «Ленту» не идут. */
export const visible = (feed: Feed): Feed => ({ ...feed, conversations: feed.conversations.filter(shown) });

/** Список «Людей»: фильтр, агент и поиск по имени или @username. */
export function filterPeople(all: Conv[], by: { filter: Filter; agent?: AgentKey; query: string }) {
  const match = FILTERS.find(([key]) => key === by.filter)![2];
  const needle = by.query.trim().toLowerCase().replace(/^@/, '');
  return all
    .filter(match)
    .filter((c) => !by.agent || c.agent === by.agent)
    .filter((c) => !needle || c.peer_name.toLowerCase().includes(needle) || c.peer_username?.toLowerCase().includes(needle));
}

/** Черновики агентов по диалогам: в ленту они не идут, а ждут решения. */
export const draftsOf = (feed: Feed) => new Map(feed.messages.filter((m) => m.status === 'draft').map((m) => [m.conversation_id, m]));

/** Лента: сообщения известных диалогов без черновиков, свежие первыми (как отдал сервер). */
export function eventsOf(feed: Feed) {
  const byId = new Map(feed.conversations.map((c) => [c.id, c]));
  return feed.messages.flatMap((m) => {
    const c = byId.get(m.conversation_id);
    return c && m.status !== 'draft' ? [{ c, m }] : [];
  });
}

/** Последнее сообщение каждого диалога — для строки в списке. */
export function lastOf(feed: Feed) {
  const last = new Map<string, Msg>();
  for (const { c, m } of eventsOf(feed)) if (!last.has(c.id)) last.set(c.id, m);
  return last;
}

/** Строки «Ленты», по которым ходит выбор: сначала диалоги, которые ждут нас, потом сообщения. */
export const feedRows = (feed: Feed) => [
  ...feed.conversations.filter((c) => c.attention).map((c) => ({ key: `c:${c.id}`, c })),
  ...eventsOf(feed).map(({ c, m }) => ({ key: `m:${m.id}`, c })),
];

/** Выбранная строка и её место; ничего не выбрано или строка пропала — первая. */
export function pick<T extends { key: string }>(rows: T[], selected: string) {
  const at = Math.max(0, rows.findIndex((r) => r.key === selected));
  return { at, cur: rows[at] };
}

/** Подпись того, кто сейчас пишет: «печатает…» у человека, «Поддержка пишет…» у агента. */
export const typingText = (t: Typing) => (t.who === 'user' ? 'печатает…' : `${t.agent ? AGENTS[t.agent].name : 'Агент'} пишет…`);
