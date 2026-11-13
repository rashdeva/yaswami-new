import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import type { HostListItem } from '@yaswami/core';
import { TOPIC_GUIDES, topicIcon } from '@yaswami/core';
import { track } from '../analytics.ts';
import { GuestRow } from '../components/GuestRow.tsx';
import { useHosts } from '../hooks/useHosts.ts';
import { useViewed } from '../hooks/useViewed.ts';

interface Props {
  city: string;
  tabs: ReactNode;
  onOpen: (host: HostListItem) => void;
}

/** Что человек ведёт — одной строкой: Practice, иначе темы событий; и сколько у него предстоящих событий. */
const doesLine = (h: HostListItem) =>
  [...(h.practices.length ? h.practices.map((p) => p.title) : h.topics), h.upcoming_count && `событий: ${h.upcoming_count}`].filter(Boolean).join(' · ');

/** Каталог организаторов и мастеров города с фильтром по темам. Открыт без входа. */
export function HostsScreen({ city, tabs, onOpen }: Props) {
  const { hosts, failed } = useHosts();
  const [topic, pickTopic] = useState<string | null>(null);
  useViewed('hosts_viewed');
  useEffect(() => { document.title = `Организаторы и мастера в городе ${city} — Я с вами`; }, [city]);

  const topics = Object.keys(TOPIC_GUIDES).filter((t) => hosts?.some((h) => h.topics.includes(t)));
  const shown = topic ? hosts?.filter((h) => h.topics.includes(topic)) : hosts;
  const setTopic = (next: string | null) => {
    if (next) track('hosts_filtered', { topic: next });
    pickTopic(next);
  };

  return (
    <>
      <div className="top">
        {tabs}
        <div className="head">
          <h1>Организаторы</h1>
          <p>📍 {city} · ведущие, мастера и площадки</p>
        </div>
      </div>
      {topics.length > 1 && (
        <div className="chips">
          <button className="chip" aria-pressed={!topic} onClick={() => setTopic(null)}>Все</button>
          {topics.map((t) => (
            <button key={t} className="chip" aria-pressed={topic === t} onClick={() => setTopic(topic === t ? null : t)}>
              <img src={topicIcon(t)} alt="" />{t[0]!.toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      )}
      {failed && <div className="state"><b>🌧</b><p>{failed.message}</p></div>}
      {!hosts && !failed && <div className="state"><div className="spinner" role="status" aria-label="Загрузка" /></div>}
      {hosts?.length === 0 && <div className="state"><b>🌿</b><p>Пока никого нет. Загляните позже.</p></div>}
      {!!shown?.length && (
        <div className="group">
          {shown.map((h) => (
            <button key={h.id} className="plain" onClick={() => onOpen(h)}>
              <GuestRow name={h.name} photo={h.photo_url} sub={doesLine(h)} label="›" />
            </button>
          ))}
        </div>
      )}
      <p className="note">Профили собраны из открытых каналов и чатов. Записывает и отвечает сам организатор.</p>
    </>
  );
}
