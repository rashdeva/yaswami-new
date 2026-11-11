import { useEffect } from 'react';
import type { Event } from '@yaswami/core';
import { TEMPLATES } from '@yaswami/core';
import type { EventListData } from '../api.ts';
import { tint, when } from '../format.ts';
import { haptic } from '../tg.ts';

const MY_STATUS = { approved: 'вы идёте', maybe: 'вы думаете', declined: 'вы не идёте', waitlist: 'вы в листе ожидания' } as const;

function note({ event, is_host, my_approval_status }: EventListData): string {
  if (event.status === 'cancelled') return 'отменено';
  if (event.status === 'draft') return 'черновик';
  if (is_host) return 'вы организатор';
  return my_approval_status ? MY_STATUS[my_approval_status] : '';
}

interface Props {
  events: EventListData[];
  onOpen: (id: string) => void;
  onNew: () => void;
  onKind: (kind: Event['kind']) => void;
}

export function ListScreen({ events, onOpen, onNew, onKind }: Props) {
  // Событие считается прошедшим через три часа после начала (или после конца, если он задан).
  const now = Date.now();
  const isPast = ({ event }: EventListData) => new Date(event.end_at ?? event.start_at).getTime() + (event.end_at ? 0 : 3 * 3600e3) < now;
  const upcoming = events.filter((e) => !isPast(e));
  const past = events.filter(isPast).reverse();

  const first = (upcoming[0] ?? past[0])?.event.kind ?? 'o';
  useEffect(() => onKind(first), [first, onKind]);

  const section = (title: string, items: EventListData[]) =>
    items.length > 0 && (
      <>
        <h2>{title}</h2>
        <div className="group">
          {items.map((item) => {
            const { event } = item;
            const extra = note(item);
            return (
              <button key={event.id} className="item" style={tint(event.kind)} onClick={() => { haptic.tap(); onOpen(event.id); }}>
                <i>{TEMPLATES[event.kind].emoji}</i>
                <div>
                  <b>{event.name}</b>
                  <small>{when(event.start_at, event.timezone)}{extra && ` · ${extra}`}</small>
                </div>
              </button>
            );
          })}
        </div>
      </>
    );

  return (
    <>
      <div className="top"><h1>Мои события</h1></div>
      {section('Скоро', upcoming)}
      {section('Прошедшие', past)}
      <div className="main"><div><button className="cta" onClick={() => { haptic.tap(); onNew(); }}>Новое событие</button></div></div>
    </>
  );
}
