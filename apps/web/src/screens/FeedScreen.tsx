import type { ReactNode } from 'react';
import { track } from '../analytics.ts';
import { useViewed } from '../hooks/useViewed.ts';
import { useEffect, useState } from 'react';
import type { CollectedEventItem, Direction, SearchEntry, TopicItem, Wire } from '@yaswami/core';
import { collectedBadges, collectedDayKey, collectedPath, collectedTime, topicIcon, topicsByDirection, topicSlug } from '@yaswami/core';
import { useCollectedFeed } from '../hooks/useCollectedFeed.ts';
import { CityPick } from '../components/CityPick.tsx';
import { useCity } from '../hooks/useSession.ts';
import { useTopicSubscription } from '../hooks/useTopicSubscription.ts';
import { useTopicItems, useTopics } from '../hooks/useTopics.ts';
import { ProfileButton } from '../components/Avatar.tsx';
import { EventRow } from '../components/EventRow.tsx';
import { SearchField } from '../components/SearchField.tsx';
import { SearchResults } from '../components/SearchResults.tsx';
import { useSearch } from '../hooks/useSearch.ts';
import { ShelfRail } from '../components/ShelfRail.tsx';
import { useShowcase } from '../hooks/useShowcase.ts';
import { dayLabel, eventsCount } from '../format.ts';
import { directionIcon } from '../icons.ts';

interface Props {
  /** Блок над списком: предложение организатору подтвердить свои события. */
  lead?: ReactNode;
  /** Блок в самом низу, когда витрина загрузилась: «Не нашли своё событие? Предложите канал». */
  tail?: ReactNode;
  onOpen: (event: CollectedEventItem) => void;
  /** «Все» у полки — экран полки целиком. */
  onOpenShelf: (id: string) => void;
  /** Плитка направления — экран направления с его темами. */
  onOpenDirection: (slug: string) => void;
  /** «Все события» в конце витрины — экран всех событий по дням. */
  onOpenAll: () => void;
  /** Запрос в строке поиска; пустой — витрина. */
  query: string;
  onQuery: (query: string) => void;
  /** Находка поиска: событие, услуга (страница мастера) или товар. */
  onOpenEntry: (entry: Wire<SearchEntry>) => void;
}

/** Значение фильтра «Популярное»: стоит в одном ряду с темами, но темой не является. */
const POPULAR = '🔥';

/**
 * Витрина: сверху полки (ADR-0009) — подборки, которые собирают команда и куратор, ниже все предстоящие события города
 * и соседних городов по дням. Открыта без входа; кто ещё не выбрал город — сначала выбирает. Выбрал тему в фильтре —
 * полки прячутся: человек ищет сам. Набрал запрос в строке поиска — вместо витрины находки, события первыми.
 */
export function FeedScreen({ lead, tail, onOpen, onOpenShelf, onOpenDirection, onOpenAll, query, onQuery, onOpenEntry }: Props) {
  const city = useCity();
  const search = useSearch(query, 'feed');
  const { items, failed } = useCollectedFeed();
  const { shelves } = useShowcase();
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
  // Плитки — направления, где есть события (внутри — темы); тема без направления — своей плиткой-фильтром.
  const topicItems = useTopicItems();
  const groups = topicsByDirection(topicItems.filter((t) => topics.includes(t.name)));
  // Есть полки и тема не выбрана — внизу не список, а кнопка «Все события» (экран /all): витрина остаётся короткой.
  // Полок нет или выбрана тема — список по дням прямо здесь.
  const compact = !topic && !!shelves?.length;
  const days: CollectedEventItem[][] = [];
  for (const item of compact ? [] : items ?? []) {
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
        {city.chosen && <CityPick />}{/* пока не выбран — ниже полноэкранный выбор города */}
      </div>
    </div>
  );
  if (city.chosen === undefined) return <>{top}<div className="state"><div className="spinner" role="status" aria-label="Загрузка" /></div></>;
  if (!city.chosen) return <>{top}<CityPicker cities={city.cities} locate={city.locate} onPick={city.set} /></>;

  const searchField = <SearchField value={query} onChange={onQuery} label="Поиск событий" placeholder="Йога, концерт, пиклбол…" />;
  if (query) {
    const open = (entry: Wire<SearchEntry>) => {
      track('search_result_opened', { type: entry.type, tab: 'feed' });
      onOpenEntry(entry);
    };
    return <>{top}{searchField}<SearchResults {...search} first="event" onOpen={open} /></>;
  }

  return (
    <>
      {top}
      {searchField}
      {/* Быстрый поиск: плитки направлений — «Тело и практики», «Детям»…; внутри направления — его темы. */}
      {(topics.length > 1 || items?.some((e) => e.popular)) && (
        <div className="quick" role="group" aria-label="Темы">
          {items?.some((e) => e.popular) && (
            <button className="tile" aria-pressed={topic === POPULAR} onClick={() => setTopic(topic === POPULAR ? null : POPULAR)}><img className="tile-ico" src={directionIcon('popular')} alt="" />Популярное</button>
          )}
          {groups.map(({ direction, topics: inside }) => direction ? (
            <button key={direction.slug} className="tile" onClick={() => { track('direction_opened', { direction: direction.slug }); onOpenDirection(direction.slug); }}>
              <img className="tile-ico" src={directionIcon(direction.slug)} alt="" />{direction.name}
            </button>
          ) : (
            <button key={inside[0]!.name} className="tile" aria-pressed={topic === inside[0]!.name} onClick={() => setTopic(topic === inside[0]!.name ? null : inside[0]!.name)}>
              <img className="tile-ico" src={topicIcon(inside[0]!.name)} alt="" />{inside[0]!.name[0]!.toUpperCase() + inside[0]!.name.slice(1)}
            </button>
          ))}
        </div>
      )}
      {topic && (
        <div className="topic-head">
          <h2>{topic === POPULAR ? 'Популярное' : topic[0]!.toUpperCase() + topic.slice(1)}</h2>
          <button className="chip" onClick={() => setTopic(null)}>✕ Все события</button>
        </div>
      )}
      {/* Первый раз спрашиваем сами; дальше темы меняются в профиле. */}
      {subscription.topics === null && (
        <TopicPicker
          groups={topicsByDirection(topicItems.filter((t) => allTopics.includes(t.name)))}
          saving={subscription.saving}
          error={subscription.failed?.message}
          onSave={(topics) => void subscription.save(topics).catch(() => {})}
        />
      )}
      {lead}
      {failed && <div className="state"><b>🌧</b><p>{failed.message}</p></div>}
      {!items && !failed && <div className="state"><div className="spinner" role="status" aria-label="Загрузка" /></div>}
      {items?.length === 0 && <div className="state"><b>🌿</b><p>Пока ничего не запланировано. Загляните позже.</p></div>}
      {!topic && shelves?.map((shelf, i) => <ShelfRail key={shelf.id} shelf={shelf} index={i} onOpen={onOpen} onMore={() => onOpenShelf(shelf.id)} />)}
      {compact && !!items?.length && <AllEventsCard items={items} onOpen={onOpenAll} />}
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
      {items && tail}
    </>
  );
}

/** Конец витрины: вход в «Все события» — иконки первых тем и сколько всего событий. */
function AllEventsCard({ items, onOpen }: { items: CollectedEventItem[]; onOpen: () => void }) {
  const icons = [...new Set(items.flatMap((e) => (e.topic ? [e.topic] : [])))].slice(0, 4);
  return (
    <button className="all-card" onClick={() => { track('all_events_opened'); onOpen(); }}>
      <span className="all-icons">{icons.map((t) => <img key={t} src={topicIcon(t)} alt="" />)}</span>
      <span className="all-text"><b>Все события</b><small>{eventsCount(items.length)} — по дням, утро, день и вечер</small></span>
      <span className="all-chev" aria-hidden="true">›</span>
    </button>
  );
}

interface PickerProps {
  /** Темы по направлениям: человек выбирает направление целиком — подписка на все его темы. */
  groups: { direction: Direction | null; topics: TopicItem[] }[];
  saving: boolean;
  error?: string;
  onSave: (topics: string[]) => void;
}

/** «Что вам интересно?» — первый вопрос о подписке. Выбор — направления: подписка на все их темы; отдельные темы — в профиле. Отказ тоже ответ. */
function TopicPicker({ groups, saving, error, onSave }: PickerProps) {
  const [picked, setPicked] = useState<string[]>([]);
  const key = (g: PickerProps['groups'][number]) => g.direction?.slug ?? g.topics[0]!.name;
  const toggle = (k: string) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  const topics = groups.filter((g) => picked.includes(key(g))).flatMap((g) => g.topics.map((t) => t.name));
  return (
    <section className="topics-ask">
      <h2>Что вам интересно?</h2>
      <p className="note lead">Отметьте направления — бот напишет в Telegram, когда в них появятся новые события. Не чаще раза в день. Отдельные темы — в профиле.</p>
      <div className="chips">
        {groups.map((g) => (
          <button key={key(g)} className="chip" aria-pressed={picked.includes(key(g))} onClick={() => toggle(key(g))}>
            <img src={g.direction ? directionIcon(g.direction.slug) : topicIcon(g.topics[0]!.name)} alt="" />{g.direction?.name ?? g.topics[0]!.name[0]!.toUpperCase() + g.topics[0]!.name.slice(1)}
          </button>
        ))}
      </div>
      {error && <p className="note" role="alert">{error}</p>}
      <div className="cta-row">
        <button className="cta" disabled={saving || !topics.length} onClick={() => onSave(topics)}>{saving ? 'Сохраняем…' : 'Сообщать о новом'}</button>
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
