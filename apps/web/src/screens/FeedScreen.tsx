import type { ReactNode } from 'react';
import { track } from '../analytics.ts';
import { useViewed } from '../hooks/useViewed.ts';
import { useEffect, useState } from 'react';
import type { CollectedEventItem } from '@yaswami/core';
import { collectedBadges, collectedDayKey, collectedPath, collectedTime, topicIcon, topicSlug } from '@yaswami/core';
import { useCollectedFeed } from '../hooks/useCollectedFeed.ts';
import { useCity } from '../hooks/useSession.ts';
import { useTopicSubscription } from '../hooks/useTopicSubscription.ts';
import { useTopics } from '../hooks/useTopics.ts';
import { ProfileButton } from '../components/Avatar.tsx';
import { EventRow } from '../components/EventRow.tsx';
import { dayLabel } from '../format.ts';

interface Props {
  /** Блок над списком: предложение организатору подтвердить свои события. */
  lead?: ReactNode;
  onOpen: (event: CollectedEventItem) => void;
}

/** Значение фильтра «Популярное»: стоит в одном ряду с темами, но темой не является. */
const POPULAR = '🔥';

/** Витрина: все предстоящие события города и соседних городов. Открыта без входа; кто ещё не выбрал город — сначала выбирает. */
export function FeedScreen({ lead, onOpen }: Props) {
  const city = useCity();
  const { items, failed } = useCollectedFeed();
  const [topic, pickTopic] = useState<string | null>(null);
  const setTopic = (next: string | null) => {
    if (next) track('feed_filtered', { topic: next });
    pickTopic(next);
  };
  useViewed('feed_viewed');
  const subscription = useTopicSubscription();

  useEffect(() => {
    document.title = `События в городе ${city.name} — Я с вами`;
  }, [city.name]);

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

  const top = (
    <div className="top">
      <ProfileButton />
      <div className="head">
        <h1>События</h1>
        {city.chosen && (
          <label className="city-pick">
            📍{' '}
            <select aria-label="Город" value={city.city_id} onChange={(e) => city.set(e.target.value)}>
              {city.cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
      </div>
    </div>
  );
  if (city.chosen === undefined) return <>{top}<div className="state"><div className="spinner" role="status" aria-label="Загрузка" /></div></>;
  if (!city.chosen) return <>{top}<CityPicker cities={city.cities} locate={city.locate} onPick={city.set} /></>;

  return (
    <>
      {top}
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
      {/* Первый раз спрашиваем сами; дальше темы меняются в профиле. */}
      {subscription.topics === null && (
        <TopicPicker
          all={allTopics}
          saving={subscription.saving}
          error={subscription.failed?.message}
          onSave={(topics) => void subscription.save(topics).catch(() => {})}
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
                  sub={[e.city_id !== city.city_id && city.nameOf(e.city_id), e.place, e.price, e.beginner_friendly && 'можно без опыта'].filter(Boolean).join(' · ')}
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
  saving: boolean;
  error?: string;
  onSave: (topics: string[]) => void;
}

/** «Что вам интересно?» — первый вопрос о темах подписки. Отказ тоже ответ: второй раз не спрашиваем, темы — в профиле. */
function TopicPicker({ all, saving, error, onSave }: PickerProps) {
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (t: string) => setPicked((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));
  return (
    <section className="topics-ask">
      <h2>Что вам интересно?</h2>
      <p className="note lead">Отметьте темы — бот напишет в Telegram, когда по ним появятся новые события. Не чаще раза в день. Поменять — в профиле.</p>
      <div className="chips">
        {all.map((t) => (
          <button key={t} className="chip" aria-pressed={picked.includes(t)} onClick={() => toggle(t)}>
            <img src={topicIcon(t)} alt="" />{t[0]!.toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {error && <p className="note" role="alert">{error}</p>}
      <div className="cta-row">
        <button className="cta" disabled={saving || !picked.length} onClick={() => onSave(picked)}>{saving ? 'Сохраняем…' : 'Сообщать о новом'}</button>
        <button className="cta alt" disabled={saving} onClick={() => onSave([])}>Не сейчас</button>
      </div>
    </section>
  );
}

interface CityPickerProps {
  cities: { id: string; name: string }[];
  locate: () => Promise<string | null>;
  onPick: (city_id: string) => void;
}

/** «Где вы?» — первый вопрос витрины: без города не знаем, что показывать. Поменять — в шапке витрины и в профиле. */
function CityPicker({ cities, locate, onPick }: CityPickerProps) {
  const [locating, setLocating] = useState(false);
  const [missed, setMissed] = useState(false);
  const byLocation = async () => {
    setLocating(true);
    const id = await locate();
    setLocating(false);
    if (id) onPick(id);
    else setMissed(true);
  };
  return (
    <section className="topics-ask">
      <h2>Где вы?</h2>
      <p className="note lead">Покажем события вашего города и соседних. Поменять можно в любой момент — нажмите на город вверху.</p>
      <div className="chips">
        {cities.map((c) => <button key={c.id} className="chip" onClick={() => onPick(c.id)}>{c.name}</button>)}
      </div>
      {missed && <p className="note" role="alert">Не получилось определить город рядом с вами — выберите из списка.</p>}
      <div className="cta-row">
        <button className="cta alt" disabled={locating} onClick={() => void byLocation()}>{locating ? 'Ищем…' : '📍 Определить по геолокации'}</button>
      </div>
    </section>
  );
}
