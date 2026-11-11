import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import type { CollectedEventItem } from '@yaswami/core';
import { collectedDay, collectedDayKey, collectedPath, collectedTime, TOPIC_GUIDES, topicIcon } from '@yaswami/core';
import { api } from '../api.ts';

interface Props {
  city: string;
  initial?: CollectedEventItem[];
  tabs: ReactNode;
  /** Блок над списком: предложение организатору подтвердить свои события. */
  lead?: ReactNode;
  onOpen: (event: CollectedEventItem) => void;
}

/** Значение фильтра «Популярное»: стоит в одном ряду с темами, но темой не является. */
const POPULAR = '🔥';

/** Витрина: все предстоящие события города. Открыта без входа. */
export function FeedScreen({ city, initial, tabs, lead, onOpen }: Props) {
  const [items, setItems] = useState<CollectedEventItem[] | null>(initial ?? null);
  const [failed, setFailed] = useState<string | null>(null);
  const [topic, setTopic] = useState<string | null>(null);

  useEffect(() => {
    if (!initial) api.collected().then(setItems, (e: Error) => setFailed(e.message));
  }, [initial]);

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
      {failed && <div className="state"><b>🌧</b><p>{failed}</p></div>}
      {!items && !failed && <div className="state"><div className="spinner" role="status" aria-label="Загрузка" /></div>}
      {items?.length === 0 && <div className="state"><b>🌿</b><p>Пока ничего не запланировано. Загляните позже.</p></div>}
      {days.map((list) => (
        <section key={collectedDayKey(list[0]!.starts_at)}>
          <h2>{collectedDay(list[0]!.starts_at)}</h2>
          <div className="covers">
            {list.map((e) => (
              <a
                key={e.id}
                className="cover"
                href={collectedPath(e.id)}
                onClick={(click) => {
                  if (click.metaKey || click.ctrlKey || click.shiftKey) return; // новая вкладка — как обычная ссылка
                  click.preventDefault();
                  onOpen(e);
                }}
              >
                {/* Обложки нет (в анонсе не было фото, свою ещё не нарисовали) — иконка темы на цветной плитке. */}
                {e.cover_url ? <img className="bg" src={e.cover_url} alt="" loading="lazy" /> : <img className="ico" src={topicIcon(e.topic)} alt="" loading="lazy" />}
                {e.popular && <span className="badge sm hot">Популярное</span>}
                <div className="cap">
                  <small>{[collectedTime(e.starts_at), e.price].filter(Boolean).join(' · ') || 'подробности у организатора'}</small>
                  <b>{e.title}</b>
                  {e.beginner_friendly && <small>можно без опыта</small>}
                </div>
              </a>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
