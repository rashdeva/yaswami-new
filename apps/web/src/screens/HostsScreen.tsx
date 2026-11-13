import { useEffect, useState } from 'react';
import type { HostListItem } from '@yaswami/core';
import { TOPIC_GUIDES, topicIcon } from '@yaswami/core';
import { track } from '../analytics.ts';
import { GuestRow } from '../components/GuestRow.tsx';
import { PracticeRow } from '../components/PracticeRow.tsx';
import { useHosts, usePracticeSignup } from '../hooks/useHosts.ts';
import { useViewed } from '../hooks/useViewed.ts';

interface Props {
  city: string;
  onOpen: (host: HostListItem) => void;
  onSearch: () => void;
}

/** Вкладка «Услуги»: мастера города и под каждым — его услуги (Practice) с записью; фильтр по темам. Открыта без входа. */
export function HostsScreen({ city, onOpen, onSearch }: Props) {
  const { hosts, failed } = useHosts();
  const signUp = usePracticeSignup();
  const [topic, pickTopic] = useState<string | null>(null);
  useViewed('hosts_viewed');
  useEffect(() => { document.title = `Услуги и мастера в городе ${city} — Я с вами`; }, [city]);

  // Организатор, у которого есть только события, сюда не попадает: к нему ведёт страница события.
  const masters = hosts?.filter((h) => h.practices.length);
  const topics = Object.keys(TOPIC_GUIDES).filter((t) => masters?.some((h) => h.practices.some((p) => p.topic === t)));
  const shown = masters?.flatMap((h) => {
    const practices = topic ? h.practices.filter((p) => p.topic === topic) : h.practices;
    return practices.length ? [{ host: h, practices }] : [];
  });
  const setTopic = (next: string | null) => {
    if (next) track('hosts_filtered', { topic: next });
    pickTopic(next);
  };

  return (
    <>
      <div className="top">
        <div className="head">
          <h1>Услуги</h1>
          <p>📍 {city} · мастера и частные занятия</p>
        </div>
      </div>
      <button className="group search" onClick={onSearch}><span className="row">🔍 Найти услугу, мастера или событие</span></button>
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
      {masters?.length === 0 && <div className="state"><b>🌿</b><p>Пока никого нет. Загляните позже.</p></div>}
      {shown?.map(({ host, practices }) => (
        <div key={host.id} className="group">
          <button className="plain" onClick={() => onOpen(host)}>
            <GuestRow name={host.name} photo={host.photo_url} sub={host.summary ?? undefined} label="›" />
          </button>
          {practices.map((p) => <PracticeRow key={p.title} practice={p} onSignUp={() => signUp(host, p.title)} />)}
        </div>
      ))}
      <p className="note">Услуги собраны из открытых каналов и чатов. Записывает и отвечает сам мастер.</p>
    </>
  );
}
