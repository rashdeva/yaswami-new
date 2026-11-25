import assert from 'node:assert/strict';
import { test } from 'node:test';
import { batchPlan, batchSummary, decisionCall, moderationQueue, moderationTotal } from './moderation.ts';

const practice = (id: string, status: 'pending' | 'published') => ({ id, title: `Услуга ${id}`, topic: 'йога', description: null, price: id === 'p1' ? '50 лари' : null, status, formats: null, for_kids: null, price_amount: null, price_currency: null });
const sources = {
  events: [
    { id: 'e1', title: 'Йога на крыше', starts_at: '2030-05-01T15:00:00.000Z', channel: 'tbilisi_events', source_url: 'https://t.me/tbilisi_events/5', status: 'pending' as const },
    { id: 'e2', title: 'Уже в ленте', starts_at: '2030-05-02T15:00:00.000Z', channel: 'c', source_url: 'https://t.me/c/1', status: 'published' as const },
  ],
  hosts: [
    { id: 'h1', name: 'Аня', username: 'anya', status: 'published' as const, created_at: '2030-01-01T00:00:00.000Z', practices: [practice('p1', 'pending'), practice('p2', 'published')] },
    { id: 'h2', name: 'Боря', username: 'borya', status: 'pending' as const, created_at: '2030-01-02T00:00:00.000Z', practices: [] },
    { id: 'h3', name: 'Вера', username: 'vera', status: 'pending' as const, created_at: '2030-01-03T00:00:00.000Z', practices: [practice('p3', 'pending')] },
  ],
  hostEvents: new Map([['vera', 2]]),
  products: [
    { id: 'g1', title: 'Медовик', price: '55k', unit: '100 г', category: 'food' as const, announcement: { url: 'https://t.me/anya_bakes/9', text: 'медовик' }, status: 'pending' as const, host: { id: 'h1', name: 'Аня', username: 'anya', city_id: 'danang' } },
    { id: 'g2', title: 'Серьги', price: null, unit: null, category: 'handmade' as const, announcement: { url: 'https://t.me/c/2', text: 'серьги' }, status: 'published' as const, host: { id: 'h3', name: 'Вера', username: 'vera', city_id: 'danang' } },
  ],
};

test('очередь: только ждущие решения, четыре группы по порядку, пустых нет', () => {
  const groups = moderationQueue(sources);
  assert.deepEqual(groups.map((g) => [g.label, g.rows.map((r) => r.key)]), [
    ['События', ['event:e1']],
    ['Услуги', ['service:p1', 'service:p3']],
    ['Мастера', ['host:h3', 'host:h2']], // свежие сверху, как на вкладке «Ждут решения»
    ['Товары', ['product:g1']],
  ]);
  assert.equal(moderationTotal(groups), 6);
  assert.deepEqual(moderationQueue({}), []);
  assert.deepEqual(moderationQueue({ events: sources.events }).map((g) => g.kind), ['event']);
});

test('строки: подпись и ссылка каждого вида', () => {
  const [events, services, hosts, products] = moderationQueue(sources).map((g) => g.rows);
  assert.match(events![0]!.subtitle, /1 мая.* · Telegram @tbilisi_events$/);
  assert.deepEqual(events![0]!.link, { entity: 'collected_event', id: 'e1' });
  assert.equal(events![0]!.url, 'https://t.me/tbilisi_events/5');
  assert.equal(services![0]!.subtitle, 'Аня · йога · 50 лари');
  assert.equal(services![1]!.subtitle, 'Вера · йога · цена по запросу');
  assert.deepEqual(services![0]!.link, { entity: 'host', id: 'h1' });
  assert.equal(hosts![0]!.subtitle, '@vera · услуг: 1 · событий: 2');
  assert.equal(hosts![1]!.subtitle, '@borya · услуг: 0 · событий: 0');
  assert.equal(products![0]!.subtitle, 'Аня · 55k · 100 г · Еда');
  assert.deepEqual(products![0]!.link, { entity: 'product', id: 'g1' });
  assert.equal(products![0]!.url, 'https://t.me/anya_bakes/9');
});

test('решение — тот же вход, что у кнопки родного экрана', () => {
  const [events, services, hosts, products] = moderationQueue(sources).map((g) => g.rows[0]!);
  assert.deepEqual(decisionCall(events!, 'approve'), { kind: 'event', input: { id: 'e1', input: { status: 'approved' } } });
  assert.deepEqual(decisionCall(events!, 'reject'), { kind: 'event', input: { id: 'e1', input: { status: 'rejected' } } });
  assert.deepEqual(decisionCall(services!, 'approve'), { kind: 'service', input: { host_id: 'h1', practice_id: 'p1', status: 'published' } });
  assert.deepEqual(decisionCall(services!, 'reject'), { kind: 'service', input: { host_id: 'h1', practice_id: 'p1', status: 'rejected' } });
  assert.deepEqual(decisionCall(hosts!, 'approve'), { kind: 'host', input: { id: 'h3', status: 'published' } });
  assert.deepEqual(decisionCall(hosts!, 'reject'), { kind: 'host', input: { id: 'h3', status: 'rejected' } });
  assert.deepEqual(decisionCall(products!, 'approve'), { kind: 'product', input: { id: 'g1', input: { status: 'published' } } });
  assert.deepEqual(decisionCall(products!, 'reject'), { kind: 'product', input: { id: 'g1', input: { status: 'rejected' } } });
});

test('план пачки: выбранные в порядке очереди, пропавшие из очереди пропускаются', () => {
  const plan = batchPlan(moderationQueue(sources), new Set(['product:g1', 'host:h2', 'event:e1', 'event:gone', 'product:g2']), 'approve');
  assert.deepEqual(plan.map((s) => s.row.key), ['event:e1', 'host:h2', 'product:g1']);
  assert.deepEqual(plan[1]!.call, { kind: 'host', input: { id: 'h2', status: 'published' } });
  assert.deepEqual(plan[2]!.call, { kind: 'product', input: { id: 'g1', input: { status: 'published' } } });
});

test('итог пачки', () => {
  assert.equal(batchSummary('approve', 5, 2), 'Одобрено: 5. Не получилось: 2 — они остались выбранными.');
  assert.match(batchSummary('reject', 0, 1), /^Отклонено: 0/);
});
