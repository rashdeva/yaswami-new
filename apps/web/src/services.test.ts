import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HostListItem, Practice, SearchEntry, TopicItem, Wire } from '@yaswami/core';
import { searchSections, serviceGroups } from './services.ts';

const practice = (title: string, topic: string): Practice => ({ id: title, title, topic, description: null, price: null, status: 'published' });
const host = (name: string, practices: Practice[]) => ({ id: name, name, practices }) as unknown as HostListItem;
const topic = (name: string, slug: string, direction: TopicItem['direction']) => ({ name, slug, direction }) as TopicItem;

test('услуги по направлениям: порядок направлений, тема без направления — своим разделом, неизвестная — в «Другом», сверху разные мастера', () => {
  const topics = [topic('йога', 'yoga', 'body'), topic('спорт', 'sport', 'sport'), topic('баня', 'banya', 'body'), topic('падел', 'padel', null), topic('танцы', 'dance', 'sport')];
  const hosts = [
    host('Максим', [practice('Бокс', 'спорт'), practice('Кроссфит', 'спорт')]),
    host('Катя', [practice('Стретчинг', 'спорт')]),
    host('Саша', [practice('Живая баня', 'баня')]),
    host('Ксения', [practice('Йога', 'йога')]),
    host('Иван', [practice('Падел', 'падел'), practice('Что-то', 'неизвестно')]),
  ];
  const groups = serviceGroups(hosts, topics);
  assert.deepEqual(groups.map((g) => [g.key, g.name, g.items.map((i) => i.practice.title)]), [
    ['body', 'Тело и практики', ['Живая баня', 'Йога']],
    ['sport', 'Спорт и движение', ['Бокс', 'Стретчинг', 'Кроссфит']],
    ['padel', 'Падел', ['Падел']],
    ['other', 'Другое', ['Что-то']],
  ]);
  assert.equal(groups[0]!.items[0]!.host.name, 'Саша');
});

test('пока темы не пришли — все услуги в «Другом»; без услуг — пусто', () => {
  assert.deepEqual(serviceGroups([host('Максим', [practice('Бокс', 'спорт')])], []).map((g) => g.key), ['other']);
  assert.deepEqual(serviceGroups([host('Организатор', [])], []), []);
});

test('находки поиска: тип вкладки первым, пустые разделы пропущены, порядок внутри сохранён', () => {
  const e = (type: SearchEntry['type'], id: string) => ({ type, id }) as unknown as Wire<SearchEntry>;
  const entries = [e('event', 'e1'), e('practice', 'p1'), e('event', 'e2'), e('practice', 'p2')];
  const ids = (s: ReturnType<typeof searchSections>) => s.map((x) => [x.type, x.entries.map((y) => (y as unknown as { id: string }).id)]);
  assert.deepEqual(ids(searchSections(entries, 'practice')), [['practice', ['p1', 'p2']], ['event', ['e1', 'e2']]]);
  assert.deepEqual(ids(searchSections(entries, 'event')), [['event', ['e1', 'e2']], ['practice', ['p1', 'p2']]]);
});
