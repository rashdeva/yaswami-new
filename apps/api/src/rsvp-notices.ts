// Уведомления о записи на событие без спама. Гость может прокликать «пойду → думаю → не пойду», а на популярное
// событие — записаться сотня человек, поэтому сразу ничего не отправляется:
// - гостю — одно подтверждение через `notifyDelayMs`, и только если к этому моменту он всё ещё записан;
//   повторно по тому же событию — не раньше чем через сутки;
// - организатору — сводка по событию («Аня, Дато и ещё 3 придут»), а не сообщение на каждого гостя; окно сводки
//   с каждой отправкой удваивается (до часа), так что поток записей не превращается в поток сообщений.
// ponytail: таймеры и отметки живут в памяти одного процесса — перезапуск сервера теряет неотправленное и
// обнуляет окна. Станет важно или появится второй экземпляр API — перенести в очередь pgmq (ADR 0002).
import { and, eq } from 'drizzle-orm';
import type { User } from '@yaswami/core';
import type { Db } from './db/client.ts';
import { events, guests, users } from './db/schema.ts';
import { notify } from './notifications.ts';
import { settings } from './settings.ts';

const DAY = 86_400_000;
const HOST_WINDOW_MAX = 3_600_000;

const guestTimers = new Set<string>(); // `${событие}:${гость}` — подтверждение уже запланировано
const guestSent = new Map<string, number>(); // когда гостю ушло подтверждение
const hostBatches = new Map<string, Map<number, User>>(); // событие → записавшиеся с прошлой сводки
const hostSent = new Map<string, number>(); // сколько сводок по событию уже ушло

const later = (ms: number, job: () => Promise<void>) => void setTimeout(() => void job().catch(console.error), ms).unref();

/** Событие и те, кто записан на него прямо сейчас. */
async function goingNow(db: Db, eventId: string) {
  const [event] = await db.select().from(events).where(eq(events.id, eventId));
  const rows = await db
    .select({ user: users, plus_ones: guests.plus_ones })
    .from(guests)
    .innerJoin(users, eq(users.id, guests.user_id))
    .where(and(eq(guests.event_id, eventId), eq(guests.approval_status, 'approved')));
  return { event, ids: new Set(rows.map((r) => r.user.id)), going: rows.reduce((n, r) => n + 1 + r.plus_ones, 0) };
}

/** Гость записался на событие. Вызывается после фиксации записи; ничего не ждёт и не бросает. */
export function guestRegistered(db: Db, event: { id: string; user_id: number }, guest: User): void {
  const key = `${event.id}:${guest.id}`;
  if (!guestTimers.has(key) && Date.now() - (guestSent.get(key) ?? 0) > DAY) {
    guestTimers.add(key);
    later(settings.notifyDelayMs, async () => {
      guestTimers.delete(key);
      const now = await goingNow(db, event.id);
      if (!now.event || !now.ids.has(guest.id)) return; // передумал, пока мы ждали
      if (guestSent.size > 10_000) guestSent.clear();
      guestSent.set(key, Date.now());
      await notify(guest.id, 'rsvp_confirmed', { event: now.event });
    });
  }

  if (event.user_id === guest.id) return; // организатор сам себе гость
  const batch = hostBatches.get(event.id);
  if (batch) return void batch.set(guest.id, guest); // сводка уже запланирована — попадёт в неё
  hostBatches.set(event.id, new Map([[guest.id, guest]]));
  const sentBefore = hostSent.get(event.id) ?? 0;
  later(Math.min(settings.notifyDelayMs * 2 ** sentBefore, HOST_WINDOW_MAX), async () => {
    const batch = [...(hostBatches.get(event.id)?.values() ?? [])];
    hostBatches.delete(event.id);
    const now = await goingNow(db, event.id);
    const stayed = batch.filter((g) => now.ids.has(g.id));
    if (!now.event || !stayed.length) return;
    if (hostSent.size > 10_000) hostSent.clear();
    hostSent.set(event.id, sentBefore + 1);
    await notify(now.event.user_id, 'guest_registered', { event: now.event, guests: stayed, going: now.going });
  });
}
