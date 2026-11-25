import { useEffect } from 'react';
import type { CollectedEventItem, ShowcaseShelf } from '@yaswami/core';
import { collectedPath, collectedTime, topicIcon } from '@yaswami/core';
import { track } from '../analytics.ts';
import { dayLabel } from '../format.ts';
import { Cover } from './Cover.tsx';

/** Когда событие: «Сегодня, 19:00» — коротко, карточка на полке узкая. */
export const shelfWhen = (e: CollectedEventItem) => [dayLabel(e.starts_at), collectedTime(e.starts_at)].filter(Boolean).join(', ');

interface Props {
  shelf: ShowcaseShelf;
  /** Место полки на витрине сверху (0 — первая): по нему куратор видит, работает ли полка или просто стоит высоко. */
  index: number;
  onOpen: (event: CollectedEventItem) => void;
  onMore: () => void;
}

/** Полка витрины: заголовок с обложкой темы и события в ряд, прокрутка вбок. «Все» — экран полки целиком. */
export function ShelfRail({ shelf, index, onOpen, onMore }: Props) {
  const props = { shelf_id: shelf.id, author: shelf.author, position: index };
  useEffect(() => { track('shelf_viewed', { shelf_id: shelf.id, author: shelf.author, position: index }); }, [shelf.id, shelf.author, index]);
  return (
    <section className="shelf">
      <div className="shelf-head">
        {shelf.topic && <img src={topicIcon(shelf.topic)} alt="" />}
        <h2>{shelf.title}</h2>
        <button className="more" onClick={() => { track('shelf_opened', props); onMore(); }}>Все {shelf.events.length}<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" /></svg></button>
      </div>
      <div className="rail">
        {shelf.events.map((e) => (
          <Cover
            key={e.id}
            href={collectedPath(e.id)}
            cover_url={e.cover_url}
            icon={topicIcon(e.topic)}
            popular={e.popular}
            meta={shelfWhen(e)}
            title={e.title}
            onOpen={() => { track('shelf_item_opened', { ...props, collected_event_id: e.id }); onOpen(e); }}
          />
        ))}
      </div>
    </section>
  );
}
