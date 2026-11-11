import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Event, Guest, GuestWithName, TicketType } from './index.ts';
import { Event as EventSchema, PUBLIC_STATE_MAX_BYTES, rsvp, ticketTypeRemovalError, toPublicState } from './index.ts';

const now = new Date('2026-11-11T12:00:00Z');
const event: Event = {
  id: 'e_2a9c', host_id: 1, kind: 's', title: 'Футбол 5×5', starts_at: new Date('2026-11-20T16:00:00Z'),
  tz: 'Asia/Tbilisi', place_text: 'Стадион «Локомотив»', place_url: null, capacity: null,
  allow_plus_one: false, status: 'published', widget_id: null, rev: 0,
};
const type = (id: string, o: Partial<TicketType> = {}): TicketType => ({
  id, event_id: event.id, name: id, description: null, max_capacity: null, is_hidden: false, price_text: null, position: 0, ...o,
});
const going = (user_id: number, ticket_type_id: string, plus_ones = 0): Guest => ({
  event_id: event.id, user_id, status: 'going', ticket_type_id, plus_ones, responded_at: now,
});
const run = (o: Partial<Parameters<typeof rsvp>[0]>) =>
  rsvp({ event, ticketTypes: [type('a')], guests: [], user_id: 9, status: 'going', now, ...o });

test('схема принимает событие и отвергает длинное название', () => {
  assert.equal(EventSchema.safeParse(event).success, true);
  assert.equal(EventSchema.safeParse({ ...event, title: 'я'.repeat(61) }).success, false);
});

test('один видимый тип: запись без выбора типа, rev растёт', () => {
  const r = run({});
  assert.ok(r.ok);
  assert.equal(r.guest.ticket_type_id, 'a');
  assert.equal(r.event.rev, 1);
  assert.equal(r.guests.length, 1);
});

test('несколько видимых типов: без выбора — ticket_required, с выбором — запись', () => {
  const ticketTypes = [type('a'), type('b')];
  assert.deepEqual(run({ ticketTypes }), { ok: false, error: 'ticket_required' });
  const r = run({ ticketTypes, ticket_type_id: 'b' });
  assert.ok(r.ok && r.guest.ticket_type_id === 'b');
});

test('скрытый и чужой тип выбрать нельзя; назначенный организатором скрытый сохраняется', () => {
  const ticketTypes = [type('a'), type('vip', { is_hidden: true })];
  assert.deepEqual(run({ ticketTypes, ticket_type_id: 'vip' }), { ok: false, error: 'ticket_unknown' });
  assert.deepEqual(run({ ticketTypes, ticket_type_id: 'nope' }), { ok: false, error: 'ticket_unknown' });
  const r = run({ ticketTypes, guests: [{ ...going(9, 'vip'), status: 'maybe' }] });
  assert.ok(r.ok && r.guest.ticket_type_id === 'vip');
});

test('лимит типа и общий лимит события', () => {
  const full = run({ ticketTypes: [type('a', { max_capacity: 2 })], guests: [going(1, 'a'), going(2, 'a')] });
  assert.deepEqual(full, { ok: false, error: 'full' });
  // «+1» занимает место
  const plus = run({ ticketTypes: [type('a', { max_capacity: 2 })], guests: [going(1, 'a', 1)] });
  assert.deepEqual(plus, { ok: false, error: 'full' });
  // в типе b места есть, но событие заполнено
  const total = run({
    event: { ...event, capacity: 2 }, ticketTypes: [type('a'), type('b')],
    guests: [going(1, 'a'), going(2, 'a')], ticket_type_id: 'b',
  });
  assert.deepEqual(total, { ok: false, error: 'full' });
});

test('своё место не считается занятым: повторный ответ не меняет rev', () => {
  const r = run({ ticketTypes: [type('a', { max_capacity: 1 })], guests: [going(9, 'a')] });
  assert.ok(r.ok);
  assert.equal(r.changed, false);
  assert.equal(r.event.rev, 0);
});

test('смена ответа освобождает место и снимает билет', () => {
  const r = run({ guests: [going(9, 'a')], status: 'declined' });
  assert.ok(r.ok);
  assert.equal(r.guest.status, 'declined');
  assert.equal(r.guest.ticket_type_id, null);
  assert.equal(r.guests.length, 1);
  assert.equal(r.event.rev, 1);
});

test('неопубликованное событие ответы не принимает', () => {
  assert.deepEqual(run({ event: { ...event, status: 'cancelled' } }), { ok: false, error: 'closed' });
});

test('последний и последний видимый тип удалить нельзя', () => {
  assert.equal(ticketTypeRemovalError([type('a')], 'a'), 'last');
  assert.equal(ticketTypeRemovalError([type('a'), type('h', { is_hidden: true })], 'a'), 'last_visible');
  assert.equal(ticketTypeRemovalError([type('a'), type('b')], 'a'), null);
});

test('состояние виджета: счётчики, имена, флаг нескольких типов', () => {
  const guests: GuestWithName[] = [
    { ...going(1, 'a', 1), first_name: 'Миша' },
    { ...going(2, 'a'), first_name: 'Дато', status: 'maybe', ticket_type_id: null },
  ];
  const s = JSON.parse(toPublicState(event, [type('a'), type('b')], guests, 'yaswamibot/app?startapp=e_2a9c'));
  assert.deepEqual(s.n, [2, 1]);
  assert.deepEqual(s.g, ['Миша']);
  assert.equal(s.m, 1);
  assert.equal(s.d, 1795190400);
});

test('состояние виджета влезает в 1024 байта на предельной кириллице', () => {
  const guests: GuestWithName[] = Array.from({ length: 8 }, (_, i) => ({ ...going(i + 1, 'a'), first_name: 'Ж'.repeat(40) }));
  const big = { ...event, title: 'Щ'.repeat(60), place_text: 'Ю'.repeat(80), capacity: 1000, rev: 99999 };
  const json = toPublicState(big, [type('a')], guests, 'yaswamibot/app?startapp=' + 'x'.repeat(600));
  assert.ok(new TextEncoder().encode(json).length <= PUBLIC_STATE_MAX_BYTES);
  assert.equal(JSON.parse(json).t, big.title);
});
