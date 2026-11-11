import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import type { CollectedEventItem } from '@yaswami/core';
import { collectedDay, collectedDayKey, collectedPath, collectedTime } from '@yaswami/core';
import { api } from '../api.ts';

interface Props {
  city: string;
  initial?: CollectedEventItem[];
  tabs: ReactNode;
  /** Блок над списком: предложение организатору подтвердить свои события. */
  lead?: ReactNode;
  onOpen: (event: CollectedEventItem) => void;
}

/** Витрина: все предстоящие события города. Открыта без входа. */
export function FeedScreen({ city, initial, tabs, lead, onOpen }: Props) {
  const [items, setItems] = useState<CollectedEventItem[] | null>(initial ?? null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!initial) api.collected().then(setItems, (e: Error) => setFailed(e.message));
  }, [initial]);

  useEffect(() => {
    document.title = `События в городе ${city} — Я с вами`;
  }, [city]);

  // Дни идут по порядку: список уже отсортирован по времени начала.
  const days: CollectedEventItem[][] = [];
  for (const item of items ?? []) {
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
      {lead}
      {failed && <div className="state"><b>🌧</b><p>{failed}</p></div>}
      {!items && !failed && <div className="state"><div className="spinner" role="status" aria-label="Загрузка" /></div>}
      {items?.length === 0 && <div className="state"><b>🌿</b><p>Пока ничего не запланировано. Загляните позже.</p></div>}
      {days.map((list) => (
        <section key={collectedDayKey(list[0]!.starts_at)}>
          <h2>{collectedDay(list[0]!.starts_at)}</h2>
          <div className="group">
            {list.map((e) => (
              <a
                key={e.id}
                className="item"
                href={collectedPath(e.id)}
                onClick={(click) => {
                  if (click.metaKey || click.ctrlKey || click.shiftKey) return; // новая вкладка — как обычная ссылка
                  click.preventDefault();
                  onOpen(e);
                }}
              >
                <i className="t">{collectedTime(e.starts_at) || '··'}</i>
                <div>
                  <b>{e.title}</b>
                  <small>{[e.place, e.price].filter(Boolean).join(' · ') || 'подробности у организатора'}</small>
                </div>
              </a>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
