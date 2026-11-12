import type { ReactNode } from 'react';
import { useViewed } from '../hooks/useViewed.ts';
import { useEffect } from 'react';
import type { CollectedEventItem, Event } from '@yaswami/core';
import { collectedDayKey, collectedIsPast, collectedTime, topicIcon } from '@yaswami/core';
import type { MyCollectedItem } from '@yaswami/core';
import type { EventListData } from '../api.ts';
import { dayLabel, kindIcon, wallParts } from '../format.ts';
import { EventRow } from '../components/EventRow.tsx';

const MY_STATUS = { approved: 'вы идёте', maybe: 'вы думаете', declined: 'вы не идёте', waitlist: 'вы в листе ожидания' } as const;

function note({ event, is_host, my_approval_status }: EventListData): string {
  if (event.status === 'cancelled') return 'отменено';
  if (event.status === 'draft') return 'черновик';
  if (is_host) return 'вы организатор';
  return my_approval_status ? MY_STATUS[my_approval_status] : '';
}

interface Props {
  events: EventListData[];
  /** Собранные события, куда человек заходил или нажимал «Записаться». */
  collected: MyCollectedItem[];
  tabs: ReactNode;
  lead?: ReactNode;
  onOpen: (id: string) => void;
  onOpenCollected: (event: CollectedEventItem) => void;
  onNew: () => void;
  onKind: (kind: Event['kind']) => void;
}

/** Строка списка: свои события и собранные выглядят одинаково. */
interface Row { key: string; kind: Event['kind']; icon: string; cover?: string | null; title: string; note: string; start: string; /** Дата и время «на стене» в поясе события: по ним день и время в списке. */ wall: string; past: boolean; open: () => void }

export function ListScreen({ events, collected, tabs, lead, onOpen, onOpenCollected, onNew, onKind }: Props) {
  // Событие считается прошедшим через три часа после начала (или после конца, если он задан).
  const now = Date.now();
  const rows: Row[] = [
    ...events.map((item): Row => {
      const { event } = item;
      return {
        key: event.id, kind: event.kind, icon: kindIcon(event.kind), title: event.name, note: note(item),
        start: event.start_at, wall: wallParts(event.start_at, event.timezone).join('T'), past: new Date(event.end_at ?? event.start_at).getTime() + (event.end_at ? 0 : 3 * 3600e3) < now, open: () => { onOpen(event.id); },
      };
    }),
    ...collected.map(({ event }): Row => ({
      key: `c:${event.id}`, kind: 'o', icon: topicIcon(event.topic), title: event.title, cover: event.cover_url,
      note: 'вы заинтересовались', start: event.starts_at, wall: event.starts_at, past: collectedIsPast(event, now), open: () => { onOpenCollected(event); },
    })),
  ].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const upcoming = rows.filter((r) => !r.past);
  const past = rows.filter((r) => r.past).reverse();

  const first = (upcoming[0] ?? past[0])?.kind ?? 'o';
  useEffect(() => { onKind(first); }, [first, onKind]);
  useViewed('my_events_viewed');

  // Как в витрине: по дням, ближайшие первыми. Прошедшие — отдельным блоком в конце.
  const grid = (items: Row[]) => (
    <div className="feed">
      {items.map((r) => <EventRow key={r.key} time={collectedTime(r.wall)} title={r.title} sub={r.note} cover_url={r.cover} icon={r.icon} onOpen={r.open} />)}
    </div>
  );
  const days: Row[][] = [];
  for (const r of upcoming) {
    const last = days.at(-1);
    if (last && collectedDayKey(last[0]!.wall) === collectedDayKey(r.wall)) last.push(r);
    else days.push([r]);
  }

  return (
    <>
      <div className="top">{tabs}<h1>Мои события</h1></div>
      {lead}
      {days.map((list) => {
        const label = dayLabel(list[0]!.wall);
        return <section key={collectedDayKey(list[0]!.wall)}><h2 className={label === 'Сегодня' ? 'cap today' : 'cap'}>{label}</h2>{grid(list)}</section>;
      })}
      {past.length > 0 && <section><h2>Прошедшие</h2>{grid(past)}</section>}
      <div className="main"><div><button className="cta" onClick={() => { onNew(); }}>Новое событие</button></div></div>
    </>
  );
}
