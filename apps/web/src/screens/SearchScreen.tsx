import { useEffect } from 'react';
import type { SearchEntry } from '@yaswami/core';
import { collectedPath, collectedTime, topicIcon, topicSlug } from '@yaswami/core';
import { track } from '../analytics.ts';
import { EventRow } from '../components/EventRow.tsx';
import { GuestRow } from '../components/GuestRow.tsx';
import { PracticeRow } from '../components/PracticeRow.tsx';
import { dayLabel } from '../format.ts';
import { usePracticeSignup } from '../hooks/useHosts.ts';
import { useSearch } from '../hooks/useSearch.ts';
import { useViewed } from '../hooks/useViewed.ts';

interface Props {
  query: string;
  onQuery: (query: string) => void;
  onOpen: (entry: SearchEntry) => void;
}

/** Единый поиск: события и услуги мастеров одним списком, самое подходящее первым. Открыт без входа. */
export function SearchScreen({ query, onQuery, onOpen }: Props) {
  const { ready, entries, failed } = useSearch(query);
  const signUp = usePracticeSignup();
  useViewed('search_viewed');
  useEffect(() => { document.title = 'Поиск — Я с вами'; }, []);
  const open = (entry: SearchEntry) => {
    track('search_result_opened', { type: entry.type });
    onOpen(entry);
  };

  return (
    <>
      <div className="top"><div className="head"><h1>Поиск</h1></div></div>
      <div className="group search">
        <label className="row">
          <input type="search" autoFocus enterKeyHint="search" placeholder="Йога, массаж, ретрит" aria-label="Что ищем" value={query} onChange={(e) => onQuery(e.target.value)} />
        </label>
      </div>
      {!ready && <p className="note">События и услуги мастеров. Окончания и мелкие опечатки не страшны.</p>}
      {failed && <div className="state"><b>🌧</b><p>{failed.message}</p></div>}
      {ready && !entries && !failed && <div className="state"><div className="spinner" role="status" aria-label="Загрузка" /></div>}
      {entries?.length === 0 && <div className="state"><b>🌿</b><p>Ничего не нашлось. Попробуйте другое слово.</p></div>}
      {!!entries?.length && (
        <div className="feed">
          {entries.map((entry) => entry.type === 'event' ? (
            <EventRow
              key={`e-${entry.event.id}`}
              href={collectedPath(entry.event.id)}
              time={[dayLabel(entry.event.starts_at), collectedTime(entry.event.starts_at)].filter(Boolean).join(', ')}
              title={entry.event.title}
              sub={[entry.event.place, entry.event.price].filter(Boolean).join(' · ')}
              cover_url={entry.event.cover_url}
              icon={topicIcon(entry.event.topic)}
              topic={topicSlug(entry.event.topic)}
              onOpen={() => open(entry)}
            />
          ) : (
            // Услуга — как во вкладке «Услуги»: мастер и под ним она сама с записью
            <div key={`p-${entry.practice.id}`} className="group">
              <button className="plain" onClick={() => open(entry)}>
                <GuestRow name={entry.host.name} photo={entry.host.photo_url} sub={entry.host.summary ?? undefined} label="›" />
              </button>
              <PracticeRow practice={entry.practice} onSignUp={() => signUp(entry.host, entry.practice)} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
