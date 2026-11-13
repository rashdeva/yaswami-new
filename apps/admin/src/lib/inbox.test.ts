import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { InboxConversation, InboxFeed, Message, Wire } from '@yaswami/core';
import { agentOf, day, draftsOf, eventsOf, feedRows, filterPeople, initials, kind, lastOf, leads, pick, sender, sendFrom, switchNote, via, visible, who } from './inbox.ts';

const conv = (id: string, over: Partial<Wire<InboxConversation>> = {}): Wire<InboxConversation> => ({
  id, channel: 'bot', account_id: null, peer_id: 1, peer_name: `Имя ${id}`, peer_username: null, mode: 'agent', attention: null, hidden_at: null,
  last_message_at: '2026-01-01T00:00:00Z', kind: 'guest', stage: 'bot', agent: null, ...over,
});
const msg = (id: string, conversation_id: string, over: Partial<Wire<Message>> = {}): Wire<Message> => ({
  id, conversation_id, direction: 'in', author: 'user', text: id, status: 'received', meta: null, created_at: '2026-01-01T00:00:00Z', ...over,
});
const feed: Wire<InboxFeed> = {
  me: 7,
  conversations: [
    conv('a', { peer_name: 'Аня', peer_username: 'Anya_K', attention: 'вопрос', kind: 'organizer', agent: 'host' }),
    conv('b', { peer_name: 'Борис', channel: 'account', account_id: 'acc', mode: 'human' }),
  ],
  messages: [
    msg('m4', 'a', { status: 'draft', direction: 'out', author: 'agent:host' }),
    msg('m3', 'b', { direction: 'out', author: 'admin:7', status: 'sent' }),
    msg('m2', 'gone'),
    msg('m1', 'a'),
  ],
  accounts: [{ id: 'acc', label: 'Рабочий', phone: '+100', status: 'active', last_error: null, daily_limit: 20, cold_today: 0, created_at: '2026-01-01T00:00:00Z' }],
};

test('автор сообщения: агент, бот, мы', () => {
  assert.equal(agentOf('agent'), 'operator');
  assert.equal(agentOf('agent:support'), 'support');
  assert.equal(agentOf('agent:unknown'), null);
  assert.equal(agentOf('bot'), null);
  assert.equal(sender(msg('x', 'a', { author: 'admin:7' }), 7), 'Вы');
  assert.equal(sender(msg('x', 'a', { author: 'admin:8' }), 7), 'Человек из команды');
  assert.equal(sender(msg('x', 'a', { author: 'agent:hunter' }), 7), 'Агент «Охотник»');
  assert.equal(kind(msg('x', 'a')), 'user');
  assert.equal(kind(msg('x', 'a', { direction: 'out', author: 'agent' })), 'agent');
});

test('подписи: через что идёт диалог и кто его ведёт', () => {
  const [a, b] = feed.conversations as [Wire<InboxConversation>, Wire<InboxConversation>];
  assert.equal(via(a, feed.accounts), 'боту');
  assert.equal(via(b, feed.accounts), 'аккаунт «Рабочий»');
  assert.equal(via(b, []), 'аккаунт «не подключён»');
  assert.equal(who(a, feed.messages[3]!, 7, feed.accounts), 'Аня → боту');
  assert.equal(who(b, feed.messages[1]!, 7, feed.accounts), 'Вы → Борис · аккаунт «Рабочий»');
  assert.equal(leads(a), 'ведёт агент «Для организаторов»');
  assert.equal(leads(b), 'ведёте вы');
  assert.equal(leads(conv('c')), 'отвечает бот');
  assert.equal(leads(conv('c', { channel: 'account' })), 'никто не ведёт');
});

test('аккаунт отправки: выбранный, иначе аккаунт диалога, иначе первый рабочий; смена — новый чат', () => {
  const account = (id: string, label: string, status: 'active' | 'error' = 'active') => ({ ...feed.accounts[0]!, id, label, status });
  const accounts = [account('old', 'Старый', 'error'), account('acc', 'Рабочий'), account('new', 'Новый')];
  const b = conv('b', { channel: 'account', account_id: 'old', stage: 'contacted' });
  assert.equal(sendFrom(conv('a'), accounts, 'new'), undefined, 'боту — без аккаунта');
  assert.equal(sendFrom(b, accounts), 'old', 'аккаунт диалога, даже если он не на связи: менять — решение человека');
  assert.equal(sendFrom(b, accounts, 'new'), 'new');
  assert.equal(sendFrom({ ...b, account_id: null }, accounts), 'acc');
  assert.equal(sendFrom({ ...b, account_id: null }, [accounts[0]!]), undefined);

  assert.equal(switchNote(b, accounts, 'old'), null);
  assert.equal(switchNote(b, accounts, 'new'), 'С этим человеком переписывались с аккаунта «Старый»: с «Новый» он увидит новый чат с другого номера.');
  assert.equal(switchNote({ ...b, stage: 'draft' }, accounts, 'new'), null, 'ещё не писали — менять нечего');
  assert.equal(switchNote({ ...b, account_id: null }, accounts, 'new'), null);
  // У сообщения остаётся аккаунт, через который оно прошло.
  assert.equal(who({ ...b, account_id: 'new' }, msg('x', 'b', { direction: 'out', author: 'admin:7', meta: { account_id: 'old' } }), 7, accounts), 'Вы → Имя b · аккаунт «Старый»');
});

test('люди: фильтр, агент и поиск', () => {
  const ids = (by: Parameters<typeof filterPeople>[1]) => filterPeople(feed.conversations, by).map((c) => c.id);
  assert.deepEqual(ids({ filter: 'all', query: '' }), ['a', 'b']);
  assert.deepEqual(ids({ filter: 'waiting', query: '' }), ['a']);
  assert.deepEqual(ids({ filter: 'guest', query: '' }), ['b']);
  assert.deepEqual(ids({ filter: 'all', agent: 'host', query: '' }), ['a']);
  assert.deepEqual(ids({ filter: 'all', query: ' @anya ' }), ['a']);
  assert.deepEqual(ids({ filter: 'all', query: 'бор' }), ['b']);
  assert.deepEqual(ids({ filter: 'organizer', query: 'бор' }), []);
  assert.deepEqual(ids({ filter: 'hidden', query: '' }), []);
});

test('скрытые: только под своим фильтром, в ленту не идут', () => {
  const hidden = { ...feed, conversations: [feed.conversations[0]!, { ...feed.conversations[1]!, hidden_at: '2026-01-02T00:00:00Z' }] };
  assert.deepEqual(filterPeople(hidden.conversations, { filter: 'all', query: '' }).map((c) => c.id), ['a']);
  assert.deepEqual(filterPeople(hidden.conversations, { filter: 'hidden', query: '' }).map((c) => c.id), ['b']);
  assert.deepEqual(eventsOf(visible(hidden)).map(({ m }) => m.id), ['m1']);
});

test('лента: черновики и чужие диалоги не идут, выбор ходит по закреплённым и сообщениям', () => {
  assert.deepEqual(eventsOf(feed).map(({ m }) => m.id), ['m3', 'm1']);
  assert.equal(draftsOf(feed).get('a')?.id, 'm4');
  assert.equal(lastOf(feed).get('a')?.id, 'm1');
  const rows = feedRows(feed);
  assert.deepEqual(rows.map((r) => r.key), ['c:a', 'm:m3', 'm:m1']);
  assert.equal(pick(rows, 'm:m3').at, 1);
  assert.equal(pick(rows, 'нет такой').cur?.key, 'c:a');
  assert.equal(pick([], '').cur, undefined);
});

test('day: сегодня, вчера, дата, год — только не текущий', () => {
  const now = new Date(2026, 10, 12, 15, 0);
  assert.equal(day(new Date(2026, 10, 12, 0, 5).toISOString(), now), 'Сегодня');
  assert.equal(day(new Date(2026, 10, 11, 23, 59).toISOString(), now), 'Вчера');
  assert.equal(day(new Date(2026, 10, 3, 12).toISOString(), now), '3 ноября');
  assert.match(day(new Date(2025, 0, 1, 12).toISOString(), now), /2025/);
});

test('initials: две буквы, лишние пробелы и пустое имя', () => {
  assert.equal(initials('Рашид Шамсудинов Ш'), 'РШ');
  assert.equal(initials('  аня  '), 'А');
  assert.equal(initials(''), '?');
});
