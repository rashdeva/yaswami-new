import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Event, Guest, GuestWithName, TicketType } from './index.ts';
import { collectedBadges, Event as EventSchema, popularIds, PUBLIC_STATE_MAX_BYTES, rsvp, ticketTypeRemovalError, toPublicState } from './index.ts';

const now = new Date('2026-11-11T12:00:00Z');
const event: Event = {
  id: 'e_2a9c', user_id: 1, kind: 's', name: 'Футбол 5×5', description: null, start_at: new Date('2026-11-20T16:00:00Z'), end_at: null,
  timezone: 'Asia/Tbilisi', city_id: 'danang', geo_address_json: { address: 'Стадион «Локомотив»' }, meeting_url: null, max_capacity: null,
  allow_plus_one: false, topic: null, what_happens: [], for_whom: null, beginner_friendly: null, takeaway: null, guide: null, status: 'published', widget_id: null, rev: 0, created_at: now,
};
const type = (id: string, o: Partial<TicketType> = {}): TicketType => ({
  id, event_id: event.id, name: id, description: null, max_capacity: null, is_hidden: false, price_text: null, position: 0, ...o,
});
const going = (user_id: number, event_ticket_type_id: string, plus_ones = 0): Guest => ({
  event_id: event.id, user_id, approval_status: 'approved', event_ticket_type_id, plus_ones, registered_at: now,
});
const run = (o: Partial<Parameters<typeof rsvp>[0]>) =>
  rsvp({ event, ticketTypes: [type('a')], guests: [], user_id: 9, approval_status: 'approved', now, ...o });

test('схема принимает событие и отвергает длинное название', () => {
  assert.equal(EventSchema.safeParse(event).success, true);
  assert.equal(EventSchema.safeParse({ ...event, name: 'я'.repeat(61) }).success, false);
});

test('один видимый тип: запись без выбора типа, rev растёт', () => {
  const r = run({});
  assert.ok(r.ok);
  assert.equal(r.guest.event_ticket_type_id, 'a');
  assert.equal(r.event.rev, 1);
  assert.equal(r.guests.length, 1);
});

test('организатор: «+1» только если событие разрешает, места считаются с ними; скрытый тип доступен', () => {
  assert.deepEqual(run({ plus_ones: 1 }), { ok: false, error: 'plus_one_off' });
  const open = { ...event, allow_plus_one: true, max_capacity: 2 };
  const r = run({ event: open, plus_ones: 1 });
  assert.ok(r.ok && r.guest.plus_ones === 1);
  assert.deepEqual(run({ event: open, plus_ones: 2 }), { ok: false, error: 'full' });
  const hidden = [type('a'), type('h', { is_hidden: true })];
  assert.deepEqual(run({ ticketTypes: hidden, event_ticket_type_id: 'h' }), { ok: false, error: 'ticket_unknown' });
  assert.ok(run({ ticketTypes: hidden, event_ticket_type_id: 'h', by_host: true }).ok);
});

test('несколько видимых типов: без выбора — ticket_required, с выбором — запись', () => {
  const ticketTypes = [type('a'), type('b')];
  assert.deepEqual(run({ ticketTypes }), { ok: false, error: 'ticket_required' });
  const r = run({ ticketTypes, event_ticket_type_id: 'b' });
  assert.ok(r.ok && r.guest.event_ticket_type_id === 'b');
});

test('скрытый и чужой тип выбрать нельзя; назначенный организатором скрытый сохраняется', () => {
  const ticketTypes = [type('a'), type('vip', { is_hidden: true })];
  assert.deepEqual(run({ ticketTypes, event_ticket_type_id: 'vip' }), { ok: false, error: 'ticket_unknown' });
  assert.deepEqual(run({ ticketTypes, event_ticket_type_id: 'nope' }), { ok: false, error: 'ticket_unknown' });
  const r = run({ ticketTypes, guests: [{ ...going(9, 'vip'), approval_status: 'maybe' }] });
  assert.ok(r.ok && r.guest.event_ticket_type_id === 'vip');
});

test('лимит типа и общий лимит события', () => {
  const full = run({ ticketTypes: [type('a', { max_capacity: 2 })], guests: [going(1, 'a'), going(2, 'a')] });
  assert.deepEqual(full, { ok: false, error: 'full' });
  // «+1» занимает место
  const plus = run({ ticketTypes: [type('a', { max_capacity: 2 })], guests: [going(1, 'a', 1)] });
  assert.deepEqual(plus, { ok: false, error: 'full' });
  // в типе b места есть, но событие заполнено
  const total = run({
    event: { ...event, max_capacity: 2 }, ticketTypes: [type('a'), type('b')],
    guests: [going(1, 'a'), going(2, 'a')], event_ticket_type_id: 'b',
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
  const r = run({ guests: [going(9, 'a')], approval_status: 'declined' });
  assert.ok(r.ok);
  assert.equal(r.guest.approval_status, 'declined');
  assert.equal(r.guest.event_ticket_type_id, null);
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
    { ...going(1, 'a', 1), user_first_name: 'Миша' },
    { ...going(2, 'a'), user_first_name: 'Дато', approval_status: 'maybe', event_ticket_type_id: null },
  ];
  const s = JSON.parse(toPublicState(event, [type('a'), type('b')], guests, 'yaswamibot/app?startapp=e_2a9c'));
  assert.deepEqual(s.n, [2, 1]);
  assert.deepEqual(s.g, ['Миша']);
  assert.equal(s.m, 1);
  assert.equal(s.d, 1795190400);
});

test('состояние виджета влезает в 1024 байта на предельной кириллице', () => {
  const guests: GuestWithName[] = Array.from({ length: 8 }, (_, i) => ({ ...going(i + 1, 'a'), user_first_name: 'Ж'.repeat(40) }));
  const big = { ...event, name: 'Щ'.repeat(60), geo_address_json: { address: 'Ю'.repeat(80) }, max_capacity: 1000, rev: 99999 };
  const json = toPublicState(big, [type('a')], guests, 'yaswamibot/app?startapp=' + 'x'.repeat(600));
  assert.ok(new TextEncoder().encode(json).length <= PUBLIC_STATE_MAX_BYTES);
  assert.equal(JSON.parse(json).t, big.name);
});

test('популярное: отклик сравнивается внутри источника', () => {
  const row = (id: string, channel: string, views: number | null, reactions: number | null) => ({ id, channel, views, reactions });
  const ids = (rows: ReturnType<typeof row>[]) => [...popularIds(rows, (r) => r.id)].sort();
  // группа: просмотров нет, считаем реакции — нужно хотя бы пять и вдвое больше медианы
  assert.deepEqual(ids([row('a', 'chat', null, 1), row('b', 'chat', null, 5), row('c', 'chat', null, null)]), ['b']);
  assert.deepEqual(ids([row('a', 'chat', null, 10), row('b', 'chat', null, 12), row('c', 'chat', null, 25)]), ['c']);
  // канал: просмотры в полтора раза выше медианы; большой канал не делает популярным всё подряд
  const big = [row('a', 'big', 9000, 0), row('b', 'big', 10000, 0), row('c', 'big', 11000, 0), row('d', 'big', 20000, 0)];
  assert.deepEqual(ids([...big, row('e', 'small', 300, 0)]), ['d']);
  // мало событий — по просмотрам не судим
  assert.deepEqual(ids(big.slice(2)), []);
});

test('collectedBadges: скоро, популярное, бесплатно — не больше двух', () => {
  const now = Date.parse('2026-11-14T10:00:00+07:00');
  const e = (starts_at: string, more: { price?: string; popular?: boolean } = {}) =>
    collectedBadges({ starts_at, ends_at: null, price: more.price ?? null, popular: more.popular }, now);
  const labels = (b: { label: string }[]) => b.map((x) => x.label);
  assert.deepEqual(labels(e('2026-11-14T10:40:00+07:00')), ['Через 40 мин']);
  assert.deepEqual(labels(e('2026-11-14T12:00:00+07:00', { popular: true, price: 'free' })), ['Через 2 ч', 'Популярное']);
  assert.deepEqual(labels(e('2026-11-14T09:00:00+07:00')), ['Уже идёт']);
  assert.deepEqual(labels(e('2026-11-14T19:00:00+07:00', { price: 'Бесплатно' })), ['Бесплатно']);
  assert.deepEqual(labels(e('2026-11-14T00:00:00+07:00')), [], 'без времени в анонсе «скоро» не ставим');
});
