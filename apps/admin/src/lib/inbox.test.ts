import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { InboxConversation, InboxFeed, Message, Wire } from '@yaswami/core';
import { agentOf, draftsOf, eventsOf, feedRows, filterPeople, kind, lastOf, leads, pick, sender, via, who } from './inbox.ts';

const conv = (id: string, over: Partial<Wire<InboxConversation>> = {}): Wire<InboxConversation> => ({
  id, channel: 'bot', account_id: null, peer_id: 1, peer_name: `Имя ${id}`, peer_username: null, mode: 'agent', attention: null,
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
  accounts: [{ id: 'acc', label: 'Рабочий', phone: '+100', status: 'active', last_error: null, created_at: '2026-01-01T00:00:00Z' }],
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
  assert.equal(who(a, feed.messages[3]!, 7, 'боту'), 'Аня → боту');
  assert.equal(who(b, feed.messages[1]!, 7, 'аккаунт «Рабочий»'), 'Вы → Борис · аккаунт «Рабочий»');
  assert.equal(leads(a), 'ведёт агент «Для организаторов»');
  assert.equal(leads(b), 'ведёте вы');
  assert.equal(leads(conv('c')), 'отвечает бот');
  assert.equal(leads(conv('c', { channel: 'account' })), 'никто не ведёт');
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
