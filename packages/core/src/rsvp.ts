import type { Event, Guest, RsvpStatus, TicketType } from './schema.ts';

export type RsvpError = 'closed' | 'ticket_required' | 'ticket_unknown' | 'full';

export type RsvpResult =
  | { ok: true; event: Event; guests: Guest[]; guest: Guest; changed: boolean }
  | { ok: false; error: RsvpError };

export interface RsvpArgs {
  event: Event;
  ticketTypes: TicketType[];
  guests: Guest[];
  user_id: number;
  status: RsvpStatus;
  ticket_type_id?: string;
  now: Date;
}

const seats = (g: Guest) => 1 + g.plus_ones;
const sum = (gs: Guest[]) => gs.reduce((n, g) => n + seats(g), 0);

/**
 * Ответ гостя на событие. Чистая функция: бэк вызывает её внутри транзакции
 * с блокировкой строки события, иначе двое займут последнее место.
 */
export function rsvp(a: RsvpArgs): RsvpResult {
  const { event, ticketTypes, guests, user_id, status, now } = a;
  if (event.status !== 'published') return { ok: false, error: 'closed' };

  const prev = guests.find((g) => g.user_id === user_id);
  const others = guests.filter((g) => g.user_id !== user_id);
  const plus_ones = prev?.plus_ones ?? 0;
  let ticket_type_id: string | null = null;

  if (status === 'going') {
    const visible = ticketTypes.filter((t) => !t.is_hidden);
    // Скрытый тип гость сам выбрать не может — только сохранить уже назначенный организатором.
    const type = a.ticket_type_id
      ? ticketTypes.find((t) => t.id === a.ticket_type_id && (!t.is_hidden || prev?.ticket_type_id === t.id))
      : (ticketTypes.find((t) => t.id === prev?.ticket_type_id) ?? (visible.length === 1 ? visible[0] : undefined));
    if (!type) return { ok: false, error: a.ticket_type_id ? 'ticket_unknown' : 'ticket_required' };

    const going = others.filter((g) => g.status === 'going');
    const need = 1 + plus_ones;
    const inType = sum(going.filter((g) => g.ticket_type_id === type.id));
    if (type.max_capacity !== null && inType + need > type.max_capacity) return { ok: false, error: 'full' };
    if (event.capacity !== null && sum(going) + need > event.capacity) return { ok: false, error: 'full' };
    ticket_type_id = type.id;
  }

  if (prev && prev.status === status && prev.ticket_type_id === ticket_type_id) {
    return { ok: true, event, guests, guest: prev, changed: false };
  }
  const guest: Guest = { event_id: event.id, user_id, status, ticket_type_id, plus_ones, responded_at: now };
  return { ok: true, event: { ...event, rev: event.rev + 1 }, guests: [...others, guest], guest, changed: true };
}

export type TicketTypeRemovalError = 'last' | 'last_visible';

/** Правило Luma: нельзя удалить или скрыть последний тип и последний видимый. null — можно. */
export function ticketTypeRemovalError(ticketTypes: TicketType[], id: string): TicketTypeRemovalError | null {
  const rest = ticketTypes.filter((t) => t.id !== id);
  if (rest.length === 0) return 'last';
  if (rest.every((t) => t.is_hidden)) return 'last_visible';
  return null;
}
