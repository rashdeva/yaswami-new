import { useEffect } from 'react';
import type { HostListItem, SearchEntry, Wire } from '@yaswami/core';
import { topicIcon } from '@yaswami/core';
import { useTopics } from '../hooks/useTopics.ts';
import { track } from '../analytics.ts';
import { ProfileButton } from '../components/Avatar.tsx';
import { PracticeSheet } from '../components/PracticeSheet.tsx';
import { SearchField } from '../components/SearchField.tsx';
import { SearchResults } from '../components/SearchResults.tsx';
import { ServiceRow } from '../components/ServiceRow.tsx';
import { servicesCount } from '../format.ts';
import { usePracticeSheet, useServices } from '../hooks/useHosts.ts';
import { useSearch } from '../hooks/useSearch.ts';
import { useViewed } from '../hooks/useViewed.ts';

interface Props {
  city: string;
  /** Запрос в строке поиска; пустой — витрина вкладки. */
  query: string;
  onQuery: (query: string) => void;
  /** Плитка или «Все» у раздела — раздел целиком (направление или тема). */
  onOpenGroup: (key: string) => void;
  onOpenHost: (host: HostListItem) => void;
  /** Находка поиска не услуга (событие, товар) — её страница. */
  onOpenEntry: (entry: Wire<SearchEntry>) => void;
}

/** Сколько услуг раздела видно на вкладке; остальные — за «Все». */
const PREVIEW = 3;

/**
 * Вкладка «Услуги»: строка поиска, плитки направлений, где есть услуги, и под ними разделы по направлениям — по три
 * услуги и «Все». Услуга открывает шторку с записью. Набран запрос — вместо витрины находки, услуги первыми. Открыта без входа.
 */
export function HostsScreen({ city, query, onQuery, onOpenGroup, onOpenHost, onOpenEntry }: Props) {
  useTopics(); // иконки тем — из базы: перерисоваться, когда пришли
  const { groups, failed } = useServices();
  const search = useSearch(query, 'services');
  const sheet = usePracticeSheet();
  useViewed('hosts_viewed');
  useEffect(() => { document.title = `Услуги и мастера в городе ${city} — Я с вами`; }, [city]);

  const total = groups?.reduce((n, g) => n + g.items.length, 0) ?? 0;
  const openGroup = (key: string) => {
    track('hosts_filtered', { direction: key });
    onOpenGroup(key);
  };
  const openEntry = (entry: Wire<SearchEntry>) => {
    track('search_result_opened', { type: entry.type, tab: 'services' });
    if (entry.type === 'practice') sheet.show(entry);
    else onOpenEntry(entry);
  };

  return (
    <>
      <div className="top">
        <ProfileButton />
        <div className="head">
          <h1>Услуги</h1>
          <p>{city}{total ? ` · ${servicesCount(total)}` : ''}</p>
        </div>
      </div>
      <SearchField value={query} onChange={onQuery} label="Поиск услуг" placeholder="Кого ищете? Тренер, скрипка, баня…" />
      {query ? <SearchResults {...search} first="practice" onOpen={openEntry} /> : (
        <>
          {failed && <div className="state"><b>🌧</b><p>{failed.message}</p></div>}
          {!groups && !failed && <div className="state"><div className="spinner" role="status" aria-label="Загрузка" /></div>}
          {groups?.length === 0 && <div className="state"><b>🌿</b><p>Пока никого нет. Загляните позже.</p></div>}
          {groups && groups.length > 1 && (
            <div className="quick" role="group" aria-label="Направления">
              {groups.map((g) => (
                <button key={g.key} className="tile" onClick={() => openGroup(g.key)}>
                  <img className="tile-ico" src={topicIcon(g.topic)} alt="" />{g.name}
                </button>
              ))}
            </div>
          )}
          {groups?.map((g) => (
            <section key={g.key} className="shelf">
              <div className="shelf-head">
                <img src={topicIcon(g.topic)} alt="" />
                <h2>{g.name}</h2>
                {g.items.length > PREVIEW && <button className="quiet" onClick={() => openGroup(g.key)}>Все {g.items.length}</button>}
              </div>
              <div className="group">
                {g.items.slice(0, PREVIEW).map((item) => <ServiceRow key={item.practice.id} {...item} onOpen={() => sheet.show(item)} />)}
              </div>
            </section>
          ))}
          <p className="note">Услуги собраны из открытых каналов и чатов. Записывает и отвечает сам мастер.</p>
        </>
      )}
      <PracticeSheet open={sheet.open} onClose={sheet.close} onPick={sheet.pick} onSignUp={sheet.signUp} onOpenHost={onOpenHost} />
    </>
  );
}
