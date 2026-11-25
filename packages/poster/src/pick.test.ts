import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CollectedEventItem } from '@yaswami/core';
import { pickPosterDays, posterDays } from './pick.ts';
import { weekRange } from './render.ts';

const ev = (id: string, starts_at: string, more: Partial<CollectedEventItem> = {}): CollectedEventItem => ({
  id, title: id, description: '', starts_at, ends_at: null, place: 'зал', address: null, price: null, tags: [], topic: 'танцы',
  signup_url: '', source_url: '', claimed_event_id: null, city_id: 'danang', cover_url: 'x', ...more,
});

test('posterDays: неделя подряд через смену месяца', () => {
  assert.deepEqual(posterDays('2026-11-29', 3), ['2026-11-29', '2026-11-30', '2026-12-01']);
});

test('pickPosterDays: темы чередуются, повтор за неделю не берём, пустой день выпадает', () => {
  const days = pickPosterDays([
    ev('йога', '2026-11-26T08:00:00+07:00', { topic: 'йога', title: 'Цигун' }),
    ev('танцы-1', '2026-11-26T10:00:00+07:00'),
    ev('танцы-2', '2026-11-26T11:00:00+07:00'),
    ev('квиз', '2026-11-26T19:00:00+07:00', { topic: 'квизы' }),
    ev('цигун-снова', '2026-11-28T08:00:00+07:00', { topic: 'йога', title: 'цигун' }),
    ev('популярное', '2026-11-28T20:00:00+07:00', { popular: true }),
  ], { from: '2026-11-26', days: 3, perDay: 3 });
  assert.deepEqual(days.map((d) => d.day), ['2026-11-26', '2026-11-28'], '27-го событий нет — слайда нет');
  assert.deepEqual(days[0]!.events.map((e) => e.id), ['йога', 'танцы-1', 'квиз'], 'вторые танцы уступают квизу; порядок — по времени');
  assert.equal(days[0]!.more, 1);
  assert.deepEqual(days[1]!.events.map((e) => e.id), ['популярное'], 'тот же цигун в субботу не повторяем');
});

test('weekRange: месяц у первой даты только если он другой', () => {
  assert.equal(weekRange('2026-11-26', '2026-12-02'), '26 ноября — 2 декабря');
  assert.equal(weekRange('2026-12-07', '2026-12-13'), '7 — 13 декабря');
});
