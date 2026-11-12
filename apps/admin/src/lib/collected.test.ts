import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AdminCollectedEvent, Wire } from '@yaswami/core';
import { changesOf, draftOf } from './collected.ts';

const event = {
  id: 'chan-1-0', title: 'Чай', description: 'Пьём чай', starts_at: '2026-11-20T19:00:00+07:00', ends_at: null, place: 'Кафе', address: null,
  price: null, tags: [], topic: 'другое', telegram_username: 'tea', whatsapp_phone: null, url: null,
} as unknown as Wire<AdminCollectedEvent>;

test('правка: без изменений — пусто; время с поясом события; пустое — null', () => {
  assert.deepEqual(changesOf(event, draftOf(event)), {});
  const draft = { ...draftOf(event), title: ' Чайная церемония ', starts_at: '2026-11-20T20:30', ends_at: '2026-11-20T22:00', place: '', price: '100 000 ₫' };
  assert.deepEqual(changesOf(event, draft), {
    title: 'Чайная церемония', starts_at: '2026-11-20T20:30:00+07:00', ends_at: '2026-11-20T22:00:00+07:00', place: null, price: '100 000 ₫',
  });
  assert.deepEqual(changesOf({ ...event, ends_at: '2026-11-20T22:00:00+07:00' }, { ...draftOf(event), ends_at: '' }), { ends_at: null });
  assert.deepEqual(changesOf({ ...event, topic: undefined }, draftOf({ ...event, topic: undefined })), {}, 'темы не было — и не появилась');
});
