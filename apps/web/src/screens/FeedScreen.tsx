import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import type { CollectedEventItem } from '@yaswami/core';
import { collectedDay, collectedDayKey, collectedPath, collectedTime, TOPIC_GUIDES, topicIcon } from '@yaswami/core';
import { useCollectedFeed } from '../hooks/useCollectedFeed.ts';
import { Cover } from '../components/Cover.tsx';

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
  const [topic, setTopic] = useState<string | null>(null);

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
        <h1>События</h1>
        <p>📍 {city}</p>
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
      {days.map((list) => (
        <section key={collectedDayKey(list[0]!.starts_at)}>
          <h2>{collectedDay(list[0]!.starts_at)}</h2>
          <div className="covers">
            {list.map((e) => (
              <Cover
                key={e.id}
                href={collectedPath(e.id)}
                cover_url={e.cover_url}
                icon={topicIcon(e.topic)}
                popular={e.popular}
                meta={[collectedTime(e.starts_at), e.price].filter(Boolean).join(' · ') || 'подробности у организатора'}
                title={e.title}
                extra={e.beginner_friendly ? 'можно без опыта' : undefined}
                onOpen={() => onOpen(e)}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
