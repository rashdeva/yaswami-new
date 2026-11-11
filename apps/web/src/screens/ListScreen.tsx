import type { ReactNode } from 'react';
import { useEffect } from 'react';
import type { CollectedEventItem, Event } from '@yaswami/core';
import { collectedIsPast, collectedWhen, topicIcon } from '@yaswami/core';
import type { MyCollectedItem } from '@yaswami/core';
import type { EventListData } from '../api.ts';
import { kindIcon, when } from '../format.ts';

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
interface Row { key: string; kind: Event['kind']; icon: string; title: string; when: string; note: string; start: string; past: boolean; open: () => void }

export function ListScreen({ events, collected, tabs, lead, onOpen, onOpenCollected, onNew, onKind }: Props) {
  // Событие считается прошедшим через три часа после начала (или после конца, если он задан).
  const now = Date.now();
  const rows: Row[] = [
    ...events.map((item): Row => {
      const { event } = item;
      return {
        key: event.id, kind: event.kind, icon: kindIcon(event.kind), title: event.name, when: when(event.start_at, event.timezone), note: note(item),
        start: event.start_at, past: new Date(event.end_at ?? event.start_at).getTime() + (event.end_at ? 0 : 3 * 3600e3) < now, open: () => { onOpen(event.id); },
      };
    }),
    ...collected.map(({ event, signed_up }): Row => ({
      key: `c:${event.id}`, kind: 'o', icon: topicIcon(event.topic), title: event.title, when: collectedWhen(event.starts_at),
      note: signed_up ? 'вы хотели записаться' : 'вы смотрели', start: event.starts_at, past: collectedIsPast(event, now), open: () => { onOpenCollected(event); },
    })),
  ].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const upcoming = rows.filter((r) => !r.past);
  const past = rows.filter((r) => r.past).reverse();

  const first = (upcoming[0] ?? past[0])?.kind ?? 'o';
  useEffect(() => onKind(first), [first, onKind]);

  const section = (title: string, items: Row[]) =>
    items.length > 0 && (
      <>
        <h2>{title}</h2>
        <div className="group">
          {items.map((r) => (
            <button key={r.key} className="item" onClick={r.open}>
              <img className="ico" src={r.icon} alt="" loading="lazy" />
              <div>
                <b>{r.title}</b>
                <small>{r.when}{r.note && ` · ${r.note}`}</small>
              </div>
            </button>
          ))}
        </div>
      </>
    );

  return (
    <>
      <div className="top">{tabs}<h1>Мои события</h1></div>
      {lead}
      {section('Скоро', upcoming)}
      {section('Прошедшие', past)}
      <div className="main"><div><button className="cta" onClick={() => { onNew(); }}>Новое событие</button></div></div>
    </>
  );
}
