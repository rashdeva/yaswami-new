import { useEffect, useState } from 'react';
import type { CollectedEventItem } from '@yaswami/core';
import { collectedBadges, collectedDayKey, collectedPath, collectedTime, directionBySlug, topicIcon, topicSlug } from '@yaswami/core';
import { track } from '../analytics.ts';
import { EventRow } from '../components/EventRow.tsx';
import { dayLabel } from '../format.ts';
import { directionIcon } from '../icons.ts';
import { useCollectedFeed } from '../hooks/useCollectedFeed.ts';
import { useCity } from '../hooks/useSession.ts';
import { useTopicItems } from '../hooks/useTopics.ts';

interface Props {
  slug: string;
  onBack: (() => void) | null;
  onOpen: (event: CollectedEventItem) => void;
  /** Такого направления нет — на витрину. */
  onGone: () => void;
}

const title = (t: string) => t[0]!.toUpperCase() + t.slice(1);

/**
 * Направление (CONTEXT.md): его темы чипами сверху и события этих тем по дням. Чип — оставить одну тему, «Все» —
 * всё направление. Шапка — в цвет первой темы направления.
 */
export function DirectionScreen({ slug, onBack, onOpen, onGone }: Props) {
  const direction = directionBySlug(slug);
  const city = useCity();
  const { items, failed } = useCollectedFeed();
  const inside = useTopicItems().filter((t) => t.direction === slug).map((t) => t.name);
  const [topic, setTopic] = useState<string | null>(null);
  useEffect(() => { if (!direction) onGone(); }, [direction, onGone]);
  useEffect(() => { if (direction) document.title = `${direction.name} — Я с вами`; }, [direction]);
  if (!direction) return null;

  const events = (items ?? []).filter((e) => e.topic && inside.includes(e.topic));
  const present = inside.filter((t) => events.some((e) => e.topic === t));
  const days: CollectedEventItem[][] = [];
  for (const e of events) {
    if (topic && e.topic !== topic) continue;
    const last = days.at(-1);
    if (last && collectedDayKey(last[0]!.starts_at) === collectedDayKey(e.starts_at)) last.push(e);
    else days.push([e]);
  }
  const pick = (next: string | null) => {
    if (next) track('direction_filtered', { direction: slug, topic: next });
    setTopic(next);
  };

  return (
    <>
      <div className={`hero${onBack ? '' : ' nb'}`} data-topic={topicSlug(present[0] ?? inside[0] ?? null)}>
        {onBack && <button className="back" onClick={onBack}>← События</button>}
        <img className="emo" src={directionIcon(direction.slug)} alt="" />
        <small>{city.name}</small>
        <h1>{direction.name}</h1>
      </div>
      {present.length > 1 && (
        <div className="quick" role="group" aria-label="Темы направления">
          <button className="tile" aria-pressed={!topic} onClick={() => pick(null)}><img className="tile-ico" src={directionIcon(direction.slug)} alt="" />Все</button>
          {present.map((t) => (
            <button key={t} className="tile" aria-pressed={topic === t} onClick={() => pick(topic === t ? null : t)}>
              <img className="tile-ico" src={topicIcon(t)} alt="" />{title(t)}
            </button>
          ))}
        </div>
      )}
      {failed && <div className="state"><b>🌧</b><p>{failed.message}</p></div>}
      {!items && !failed && <div className="state"><div className="spinner" role="status" aria-label="Загрузка" /></div>}
      {items && !events.length && <div className="state"><b>🌿</b><p>В этом направлении пока ничего не запланировано. Загляните позже.</p></div>}
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
                sub={[e.city_id !== city.city_id && city.nameOf(e.city_id), e.place, e.price, e.beginner_friendly && 'можно без опыта'].filter(Boolean).join(' · ')}
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
