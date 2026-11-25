import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HostListItem, Practice, SearchEntry, TopicItem, Wire } from '@yaswami/core';
import { cheapest, formatLabel, money, practicePrice, searchSections, serviceGroups, serviceShortcuts, usefulFilters, type ServiceItem } from './services.ts';

const practice = (title: string, topic: string, details: Partial<Practice> = {}): Practice =>
  ({ id: title, title, topic, description: null, price: null, status: 'published', formats: null, for_kids: null, price_amount: null, price_currency: null, ...details });
const item = (title: string, details: Partial<Practice> = {}, topic = 'спорт'): ServiceItem => ({ practice: practice(title, topic, details), host: host('Мастер', []) });

test('цена коротко и одинаково: донги тысячами и миллионами, доллары знаком, бесплатно словом', () => {
  assert.deepEqual([money(150000, 'VND'), money(1200000, 'VND'), money(30, 'USD'), money(0, 'VND'), money(2500, 'LKR'), money(45, 'GEL'), money(500, 'THB')],
    ['150k ₫', '1,2 млн ₫', '$30', 'бесплатно', 'Rs 2 500', '45 ₾', '500 THB']); // разряды — неразрывным пробелом, как toLocaleString
  assert.equal(practicePrice({ price: '500.000 VND', price_amount: 500000, price_currency: 'VND' }), '500k ₫');
  assert.equal(practicePrice({ price: 'от 500K', price_amount: null, price_currency: null }), 'от 500K', 'не разобрана — как написал мастер');
  assert.equal(practicePrice({ price: null, price_amount: null, price_currency: null }), 'цена по запросу');
  assert.equal(formatLabel({ formats: ['personal', 'online'] }), 'лично, онлайн');
  assert.equal(formatLabel({ formats: null }), '');
});

test('«Попробовать недорого»: самые дешёвые в главной валюте города, бесплатные — всегда; меньше трёх — пусто', () => {
  const items = [
    item('Йога', { price_amount: 250000, price_currency: 'VND' }), item('Шахматы', { price_amount: 150000, price_currency: 'VND' }),
    item('Психолог', { price_amount: 30, price_currency: 'USD' }), item('Пластика', { price_amount: 0, price_currency: null }),
    item('Баня', { price_amount: 800000, price_currency: 'VND' }), item('Бокс'),
  ];
  assert.deepEqual(cheapest(items, 3).map((i) => i.practice.title), ['Пластика', 'Шахматы', 'Йога']);
  assert.deepEqual(cheapest(items.slice(0, 2), 3), []);
});

test('сквозные разделы: мастер-классы по формату, «Детям» — по разбору и по теме направления', () => {
  const topics = [topic('детям', 'kids', 'kids'), topic('спорт', 'sport', 'sport')];
  const items = [item('Акрил', { formats: ['workshop'] }), item('Скрипка', { for_kids: true }), item('Лего', {}, 'детям'), item('Бокс', { formats: ['personal'] })];
  assert.deepEqual(serviceShortcuts(items, topics).map((g) => [g.key, g.items.map((i) => i.practice.title)]), [['workshops', ['Акрил']], ['kids', ['Скрипка', 'Лего']]]);
  assert.deepEqual(serviceShortcuts([item('Бокс')], topics), []);
});

test('фильтры раздела — только те, что что-то меняют', () => {
  const items = [item('Бокс', { formats: ['personal', 'group'], price_amount: 1, price_currency: 'VND' }), item('Кроссфит', { formats: ['group'] })];
  assert.deepEqual(usefulFilters(items), ['personal', 'priced']);
});
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
