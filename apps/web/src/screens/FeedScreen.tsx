import type { ReactNode } from 'react';
import { track } from '../analytics.ts';
import { useViewed } from '../hooks/useViewed.ts';
import { useEffect, useState } from 'react';
import type { CollectedEventItem } from '@yaswami/core';
import { collectedBadges, collectedDayKey, collectedPath, collectedTime, topicIcon, topicSlug } from '@yaswami/core';
import { useCollectedFeed } from '../hooks/useCollectedFeed.ts';
import { useTopicSubscription } from '../hooks/useTopicSubscription.ts';
import { useTopics } from '../hooks/useTopics.ts';
import { CityPicker } from '../components/CityPicker.tsx';
import { EventRow } from '../components/EventRow.tsx';
import { dayLabel } from '../format.ts';

interface Props {
  city: string;
  /** Блок над списком: предложение организатору подтвердить свои события. */
  lead?: ReactNode;
  onOpen: (event: CollectedEventItem) => void;
}

/** Значение фильтра «Популярное»: стоит в одном ряду с темами, но темой не является. */
const POPULAR = '🔥';

/** Витрина: все предстоящие события города. Открыта без входа. */
export function FeedScreen({ city, lead, onOpen }: Props) {
  const { items, failed } = useCollectedFeed();
  const [topic, pickTopic] = useState<string | null>(null);
  const setTopic = (next: string | null) => {
    if (next) track('feed_filtered', { topic: next });
    pickTopic(next);
  };
  useViewed('feed_viewed');
  const subscription = useTopicSubscription();
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    document.title = `События в городе ${city} — Я с вами`;
  }, [city]);

  // Дни идут по порядку: список уже отсортирован по времени начала.
  // Фильтр предлагает только темы, по которым есть события; порядок — как в гиде.
  const allTopics = useTopics();
  const topics = allTopics.filter((t) => items?.some((e) => e.topic === t));
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
        <div className="head">
          <h1>События</h1>
          <CityPicker />
          {subscription.topics && !editing && (
            <button className="chip" onClick={() => setEditing(true)}>🔔 {subscription.topics.length ? `Мои темы: ${subscription.topics.length}` : 'Сообщать о новом'}</button>
          )}
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
      {(subscription.topics === null || (editing && subscription.topics)) && (
        <TopicPicker
          key={String(editing)}
          all={allTopics}
          initial={subscription.topics ?? []}
          asked={subscription.topics !== null}
          saving={subscription.saving}
          error={subscription.failed?.message}
          onSave={(topics) => subscription.save(topics).then(() => setEditing(false), () => {})}
          onCancel={() => setEditing(false)}
        />
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
                  topic={topicSlug(e.topic)}
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

interface PickerProps {
  all: string[];
  initial: string[];
  /** Человек уже отвечал: это правка, а не первый вопрос. */
  asked: boolean;
  saving: boolean;
  error?: string;
  onSave: (topics: string[]) => void;
  onCancel: () => void;
}

/** «Что вам интересно?» — выбор тем подписки. Первый раз показывается сам; отказ тоже ответ, второй раз не спрашиваем. */
function TopicPicker({ all, initial, asked, saving, error, onSave, onCancel }: PickerProps) {
  const [picked, setPicked] = useState(initial);
  const toggle = (t: string) => setPicked((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));
  return (
    <section className="topics-ask">
      <h2>Что вам интересно?</h2>
      <p className="note lead">Отметьте темы — бот напишет в Telegram, когда по ним появятся новые события. Не чаще раза в день.</p>
      <div className="chips">
        {all.map((t) => (
          <button key={t} className="chip" aria-pressed={picked.includes(t)} onClick={() => toggle(t)}>
            <img src={topicIcon(t)} alt="" />{t[0]!.toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {error && <p className="note" role="alert">{error}</p>}
      <div className="cta-row">
        <button className="cta" disabled={saving || (!asked && !picked.length)} onClick={() => onSave(picked)}>{saving ? 'Сохраняем…' : asked && !picked.length ? 'Не сообщать' : 'Сообщать о новом'}</button>
        <button className="cta alt" disabled={saving} onClick={() => (asked ? onCancel() : onSave([]))}>{asked ? 'Отмена' : 'Не сейчас'}</button>
      </div>
    </section>
  );
}
