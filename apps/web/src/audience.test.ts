import assert from 'node:assert/strict';
import { test } from 'node:test';
import { audienceCounts, audienceNote } from './audience.ts';

test('аудитория организатора: гость или клиент и чем он связан с организатором', () => {
  const people = [
    { practices: [], event_approved_count: 3, event_pending_count: 0 }, { practices: [], event_approved_count: 0, event_pending_count: 0 },
    { practices: [], event_approved_count: 0, event_pending_count: 2 },
    { practices: ['Массаж спины'], event_approved_count: 1, event_pending_count: 0 }, { practices: ['Массаж спины', 'Парение'], event_approved_count: 0, event_pending_count: 0 },
  ];
  assert.deepEqual(people.map(audienceNote), [
    'гость · идёт на 3 события', 'заходит на ваши события', 'гость · запись на 2 события', 'клиент · «Массаж спины»', 'клиент · «Массаж спины» и ещё 1',
  ]);
  assert.deepEqual(audienceCounts(people), { guests: 3, clients: 2 });
});
