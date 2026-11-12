import type { ReactNode } from 'react';
import { track } from '../analytics.ts';
import { useViewed } from '../hooks/useViewed.ts';
import { useEffect, useState } from 'react';
import type { CollectedEventItem } from '@yaswami/core';
import { collectedBadges, collectedDayKey, collectedPath, collectedTime, TOPIC_GUIDES, topicIcon } from '@yaswami/core';
import { useCollectedFeed } from '../hooks/useCollectedFeed.ts';
import { EventRow } from '../components/EventRow.tsx';
import { dayLabel } from '../format.ts';

interface Props {
  city: string;
  tabs: ReactNode;
  /** Блок над списком: предложение организатору подтвердить свои события. */
  lead?: ReactNode;
  onOpen: (event: CollectedEventItem) => void;
}

/** Значение фильтра «Популярное»: стоит в одном ряду с темами, но темой не является. */
const POPULAR = '🔥';

/** Витрина: все предстоящие события города. Открыта без входа. */
export function FeedScreen({ city, tabs, lead, onOpen }: Props) {
  const { items, failed } = useCollectedFeed();
  const [topic, pickTopic] = useState<string | null>(null);
  const setTopic = (next: string | null) => {
    if (next) track('feed_filtered', { topic: next });
    pickTopic(next);
  };
  useViewed('feed_viewed');

  useEffect(() => {
    document.title = `События в городе ${city} — Я с вами`;
  }, [city]);

  // Дни идут по порядку: список уже отсортирован по времени начала.
  // Фильтр предлагает только темы, по которым есть события; порядок — как в гиде.
  const topics = Object.keys(TOPIC_GUIDES).filter((t) => items?.some((e) => e.topic === t));
  const days: CollectedEventItem[][] = [];
  for (const item of items ?? []) {
    if (topic && (topic === POPULAR ? !item.popular : item.topic !== topic)) continue;
    const last = days.at(-1);
    if (last && collectedDayKey(last[0]!.starts_at) === collectedDayKey(item.starts_at)) last.push(item);
    else days.push([item]);
  }

  return (
    <>
      <div className="top">
        {tabs}
        <div className="head">
          <h1>События</h1>
          <p>📍 {city}</p>
        </div>
      </div>
      {(topics.length > 1 || items?.some((e) => e.popular)) && (
        <div className="chips">
          <button className="chip" aria-pressed={!topic} onClick={() => setTopic(null)}>Все</button>
          {items?.some((e) => e.popular) && (
            <button className="chip" aria-pressed={topic === POPULAR} onClick={() => setTopic(topic === POPULAR ? null : POPULAR)}><span className="hot" />Популярное</button>
          )}
          {topics.map((t) => (
            <button key={t} className="chip" aria-pressed={topic === t} onClick={() => setTopic(topic === t ? null : t)}>
              <img src={topicIcon(t)} alt="" />{t[0]!.toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      )}
      {lead}
      {failed && <div className="state"><b>🌧</b><p>{failed.message}</p></div>}
      {!items && !failed && <div className="state"><div className="spinner" role="status" aria-label="Загрузка" /></div>}
      {items?.length === 0 && <div className="state"><b>🌿</b><p>Пока ничего не запланировано. Загляните позже.</p></div>}
      {days.map((list) => {
        const label = dayLabel(list[0]!.starts_at);
        return (
          <section key={collectedDayKey(list[0]!.starts_at)}>
            <h2 className={label === 'Сегодня' ? 'cap today' : 'cap'}>{label}</h2>
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
                  badges={collectedBadges(e)}
                  onOpen={() => onOpen(e)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}
