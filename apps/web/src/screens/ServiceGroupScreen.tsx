import { useEffect } from 'react';
import type { HostListItem } from '@yaswami/core';
import { topicIcon, topicSlug } from '@yaswami/core';
import { PracticeSheet } from '../components/PracticeSheet.tsx';
import { ServiceRow } from '../components/ServiceRow.tsx';
import { servicesCount } from '../format.ts';
import { usePracticeSheet, useServices } from '../hooks/useHosts.ts';
import { useTopics } from '../hooks/useTopics.ts';

interface Props {
  /** Ключ раздела: slug направления или темы без направления (serviceGroups). */
  groupKey: string;
  city: string;
  onBack: (() => void) | null;
  onOpenHost: (host: HostListItem) => void;
  /** Такого раздела нет (или в нём не осталось услуг) — назад на вкладку. */
  onGone: () => void;
}

/** Раздел вкладки «Услуги» целиком: все услуги направления, шапка — в цвет его первой темы. */
export function ServiceGroupScreen({ groupKey, city, onBack, onOpenHost, onGone }: Props) {
  useTopics();
  const { groups, failed } = useServices();
  const sheet = usePracticeSheet();
  const group = groups?.find((g) => g.key === groupKey);
  useEffect(() => { if (groups && !group) onGone(); }, [groups, group, onGone]);
  useEffect(() => { if (group) document.title = `${group.name}: услуги в городе ${city} — Я с вами`; }, [group, city]);

  if (!group) {
    return failed
      ? <div className="state"><b>🌧</b><p>{failed.message}</p></div>
      : <div className="state"><div className="spinner" role="status" aria-label="Загрузка" /></div>;
  }
  return (
    <>
      <div className={`hero${onBack ? '' : ' nb'}`} data-topic={topicSlug(group.topic)}>
        {onBack && <button className="back" onClick={onBack}>← Услуги</button>}
        <img className="emo" src={topicIcon(group.topic)} alt="" />
        <small>{city} · {servicesCount(group.items.length)}</small>
        <h1>{group.name}</h1>
      </div>
      <div className="group">
        {group.items.map((item) => <ServiceRow key={item.practice.id} {...item} onOpen={() => sheet.show(item)} />)}
      </div>
      <PracticeSheet open={sheet.open} onClose={sheet.close} onPick={sheet.pick} onSignUp={sheet.signUp} onOpenHost={onOpenHost} />
    </>
  );
}
