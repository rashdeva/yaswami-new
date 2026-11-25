import { useEffect } from 'react';
import type { CollectedEventItem } from '@yaswami/core';
import { collectedBadges, collectedDayKey, collectedPath, collectedTime, topicIcon, topicSlug } from '@yaswami/core';
import { EventRow } from '../components/EventRow.tsx';
import { dayLabel } from '../format.ts';
import { useShelf } from '../hooks/useShowcase.ts';
import { useViewed } from '../hooks/useViewed.ts';

interface Props {
  id: string;
  onBack: (() => void) | null;
  onOpen: (event: CollectedEventItem) => void;
  /** Полки уже нет на витрине (сняли, кончились события) — на витрину. */
  onGone: () => void;
}

/** Полка витрины целиком: её события по дням. Шапка — в цвет темы полки, как у события. */
export function ShelfScreen({ id, onBack, onOpen, onGone }: Props) {
  const { shelf, loading, failed } = useShelf(id);
  useViewed('shelf_opened', id);
  useEffect(() => { if (shelf) document.title = `${shelf.title} — Я с вами`; }, [shelf]);
  useEffect(() => { if (!loading && !failed && !shelf) onGone(); }, [loading, failed, shelf, onGone]);

  if (failed) return <div className="state"><b>🌧</b><p>{failed.message}</p></div>;
  if (!shelf) return <div className="state"><div className="spinner" role="status" aria-label="Загрузка" /></div>;

  const days: CollectedEventItem[][] = [];
  for (const e of shelf.events) {
    const last = days.at(-1);
    if (last && collectedDayKey(last[0]!.starts_at) === collectedDayKey(e.starts_at)) last.push(e);
    else days.push([e]);
  }
  return (
    <>
      <div className={`hero shelf-hero${onBack ? '' : ' nb'}`} data-topic={topicSlug(shelf.topic)}>
        {onBack && <button className="back" onClick={onBack}>← События</button>}
        {shelf.topic && <img className="emo" src={topicIcon(shelf.topic)} alt="" />}
        <small>{shelf.events.length} событий</small>
        <h1>{shelf.title}</h1>
      </div>
      {days.map((list) => (
        <section key={collectedDayKey(list[0]!.starts_at)}>
          <h2 className="cap">{dayLabel(list[0]!.starts_at)}</h2>
          <div className="feed">
            {list.map((e) => (
              <EventRow
                key={e.id}
                href={collectedPath(e.id)}
                time={collectedTime(e.starts_at)}
                title={e.title}
                sub={[e.place, e.price, e.beginner_friendly && 'можно без опыта'].filter(Boolean).join(' · ')}
                cover_url={e.cover_url}
                icon={topicIcon(e.topic)}
                topic={topicSlug(e.topic)}
                badges={collectedBadges(e)}
                onOpen={() => onOpen(e)}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
