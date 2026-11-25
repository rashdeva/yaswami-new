import { useEffect, useState } from 'react';
import type { CollectedEventItem } from '@yaswami/core';
import { byDaypart, collectedDay, collectedDayKey, collectedPath, collectedTime, topicIcon, topicSlug } from '@yaswami/core';
import { track } from '../analytics.ts';
import { dayLabel, eventsCount, localDate } from '../format.ts';
import { CityPick } from '../components/CityPick.tsx';
import { useCollectedFeed } from '../hooks/useCollectedFeed.ts';
import { useCity } from '../hooks/useSession.ts';

interface Props {
  onBack: (() => void) | null;
  onOpen: (event: CollectedEventItem) => void;
}

const WEEKDAY = new Intl.DateTimeFormat('ru', { weekday: 'short', timeZone: 'UTC' });
/** Короткая подпись дня (YYYY-MM-DD) в переключателе: «Сегодня», «Завтра», дальше «пт 28». */
const noon = (day: string) => `${day}T12:00:00`; // dayLabel и collectedDay берут «настенное» время из строки ISO
const chipLabel = (day: string) => {
  const label = dayLabel(noon(day));
  return label === 'Сегодня' || label === 'Завтра' ? label : `${WEEKDAY.format(new Date(`${day}T00:00:00Z`))} ${Number(day.slice(8, 10))}`;
};
const capital = (s: string) => s[0]!.toUpperCase() + s.slice(1);
/** День события на экране: начатое раньше и ещё идущее (многодневный тур) — сегодня, а не день начала. */
const dayOf = (e: CollectedEventItem, today: string) => {
  const key = collectedDayKey(e.starts_at);
  return key < today ? today : key;
};

/**
 * «Все события»: один день за раз, по частям — утро, день, вечер; события плитками в две колонки. Дни — переключателем
 * сверху, все дни, где что-то есть. Вход — кнопка в конце витрины.
 */
export function AllEventsScreen({ onBack, onOpen }: Props) {
  const city = useCity();
  const { items, failed } = useCollectedFeed();
  const today = localDate();
  const days = [...new Set((items ?? []).map((e) => dayOf(e, today)))].sort();
  const [picked, setPicked] = useState<string | null>(null);
  const day = picked && days.includes(picked) ? picked : days[0] ?? null;
  const events = (items ?? []).filter((e) => dayOf(e, today) === day);
  const title = day ? dayLabel(noon(day)) : null;
  useEffect(() => { document.title = `Все события — ${city.name} — Я с вами`; }, [city.name]);
  const pick = (d: string) => {
    track('all_events_day', { day: d });
    setPicked(d);
  };

  return (
    <>
      <div className="top all-top">
        {onBack && <button className="chip" onClick={onBack}>← События</button>}
        <div className="head">
          <h1>{title ? capital(title) : 'Все события'}</h1>
          {day && <p>{title === 'Сегодня' || title === 'Завтра' ? `${collectedDay(noon(day))} · ` : ''}{eventsCount(events.length)}</p>}
          <CityPick />
        </div>
      </div>
      {days.length > 1 && (
        <div className="days" role="tablist" aria-label="День">
          {days.map((d) => <button key={d} role="tab" className="day-chip" aria-selected={d === day} onClick={() => pick(d)}>{chipLabel(d)}</button>)}
        </div>
      )}
      {failed && <div className="state"><b>🌧</b><p>{failed.message}</p></div>}
      {!items && !failed && <div className="state"><div className="spinner" role="status" aria-label="Загрузка" /></div>}
      {items?.length === 0 && <div className="state"><b>🌿</b><p>Пока ничего не запланировано. Загляните позже.</p></div>}
      {byDaypart(events).map(({ part, events: list }) => (
        <section key={part.key} className="part">
          <h2>{part.emoji} {part.label} <span>{list.length}</span></h2>
          <div className="tiles">
            {list.map((e) => (
              <a
                key={e.id}
                className="ev-tile"
                data-topic={topicSlug(e.topic)}
                href={collectedPath(e.id)}
                onClick={(click) => {
                  if (click.metaKey || click.ctrlKey || click.shiftKey) return;
                  click.preventDefault();
                  onOpen(e);
                }}
              >
                <span className="ev-tile-hd"><img src={topicIcon(e.topic)} alt="" />{collectedTime(e.starts_at) && <time>{collectedTime(e.starts_at)}</time>}</span>
                <b>{e.title}</b>
                <small>{[e.city_id !== city.city_id && city.nameOf(e.city_id), e.place, e.price].filter(Boolean).join(' · ')}</small>
              </a>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
