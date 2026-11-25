import { useEffect, useState } from 'react';
import type { HostListItem } from '@yaswami/core';
import { topicIcon, topicSlug } from '@yaswami/core';
import { track } from '../analytics.ts';
import { PracticeSheet } from '../components/PracticeSheet.tsx';
import { ServiceRow } from '../components/ServiceRow.tsx';
import { servicesCount } from '../format.ts';
import { usePracticeSheet, useServices } from '../hooks/useHosts.ts';
import { useTopics } from '../hooks/useTopics.ts';
import { FILTER_LABELS, matchesFilter, usefulFilters, type ServiceFilter } from '../services.ts';

interface Props {
  /** Ключ раздела: направление, тема без направления или сквозной раздел (serviceGroups, serviceShortcuts, CHEAP). */
  groupKey: string;
  city: string;
  onBack: (() => void) | null;
  onOpenHost: (host: HostListItem) => void;
  /** Такого раздела нет (или в нём не осталось услуг) — назад на вкладку. */
  onGone: () => void;
}

/**
 * Раздел вкладки «Услуги» целиком: все его услуги, сверху фильтры по формату и «С ценой» — только те, что что-то меняют.
 * Шапка — в цвет темы раздела.
 */
export function ServiceGroupScreen({ groupKey, city, onBack, onOpenHost, onGone }: Props) {
  useTopics();
  const { sections, find, failed } = useServices();
  const sheet = usePracticeSheet();
  const [filter, setFilter] = useState<ServiceFilter | null>(null);
  const group = find(groupKey);
  const name = group?.name;
  useEffect(() => { if (sections && !name) onGone(); }, [sections, name, onGone]);
  useEffect(() => { if (name) document.title = `${name}: услуги в городе ${city} — Я с вами`; }, [name, city]);

  if (!group) {
    return failed
      ? <div className="state"><b>🌧</b><p>{failed.message}</p></div>
      : <div className="state"><div className="spinner" role="status" aria-label="Загрузка" /></div>;
  }
  const filters = usefulFilters(group.items);
  const shown = filter ? group.items.filter((i) => matchesFilter(i, filter)) : group.items;
  const pick = (next: ServiceFilter | null) => {
    if (next) track('hosts_filtered', { direction: groupKey, filter: next });
    setFilter(next);
  };
  return (
    <>
      <div className={`hero${onBack ? '' : ' nb'}`} data-topic={topicSlug(group.topic)}>
        {onBack && <button className="back" onClick={onBack}>← Услуги</button>}
        <img className="emo" src={topicIcon(group.topic)} alt="" />
        <small>{city} · {servicesCount(group.items.length)}</small>
        <h1>{group.name}</h1>
      </div>
      {filters.length > 0 && (
        <div className="chips filters" role="group" aria-label="Формат">
          <button className="chip" aria-pressed={!filter} onClick={() => pick(null)}>Все</button>
          {filters.map((f) => <button key={f} className="chip" aria-pressed={filter === f} onClick={() => pick(filter === f ? null : f)}>{FILTER_LABELS[f]}</button>)}
        </div>
      )}
      <div className="group">
        {shown.map((item) => <ServiceRow key={item.practice.id} {...item} onOpen={() => sheet.show(item)} />)}
      </div>
      <PracticeSheet open={sheet.open} onClose={sheet.close} onPick={sheet.pick} onSignUp={sheet.signUp} onOpenHost={onOpenHost} />
    </>
  );
}
