import type { Event, Guest, TicketType } from './schema.ts';
import { ADDRESS_MAX, NAME_MAX } from './schema.ts';

export const PUBLIC_STATE_MAX_BYTES = 1024;
const NAMES_MAX = 5;
const GUEST_NAME_MAX = 16;

const bytes = (s: string) => new TextEncoder().encode(s).length;
// По символам, а не по UTF-16: не режем эмодзи пополам.
const cut = (s: string, n: number) => {
  const chars = [...s];
  return chars.length <= n ? s : chars.slice(0, n - 1).join('') + '…';
};

export type GuestWithName = Guest & { user_first_name: string };

/**
 * Общее состояние виджета (`public_data`), строка не длиннее 1024 байт.
 * r ревизия · k шаблон · t название · d время (unix) · p место · c лимит · n [пойдут, думают] ·
 * g первые имена · m 1, если видимых типов билетов несколько («Пойду» открывает мини-приложение) · u ссылка.
 */
export function toPublicState(event: Event, ticketTypes: TicketType[], guests: GuestWithName[], url: string): string {
  const approved = guests.filter((g) => g.approval_status === 'approved');
  const state = {
    r: event.rev,
    k: event.kind,
    t: cut(event.name, NAME_MAX),
    d: Math.floor(event.start_at.getTime() / 1000),
    p: cut(event.geo_address_json?.address ?? '', ADDRESS_MAX),
    c: event.max_capacity,
    n: [approved.reduce((n, g) => n + 1 + g.plus_ones, 0), guests.filter((g) => g.approval_status === 'maybe').length],
    g: approved
      .toSorted((a, b) => a.registered_at.getTime() - b.registered_at.getTime())
      .slice(0, NAMES_MAX)
      .map((g) => cut(g.user_first_name, GUEST_NAME_MAX)),
    m: ticketTypes.filter((t) => !t.is_hidden).length > 1 ? 1 : 0,
    u: url,
  };
  // При бюджете из схемы сюда не попадаем; страховка на длинную ссылку: сначала жертвуем именами, потом местом.
  let json = JSON.stringify(state);
  while (bytes(json) > PUBLIC_STATE_MAX_BYTES && state.g.length > 0) {
    state.g.pop();
    json = JSON.stringify(state);
  }
  while (bytes(json) > PUBLIC_STATE_MAX_BYTES && state.p.length > 0) {
    state.p = [...state.p].slice(0, -1).join('');
    json = JSON.stringify(state);
  }
  if (bytes(json) > PUBLIC_STATE_MAX_BYTES) throw new Error('public state does not fit in 1024 bytes');
  return json;
}
