import type { SearchEntry, Wire } from '@yaswami/core';
import { collectedPath, collectedTime, topicIcon, topicSlug } from '@yaswami/core';
import { dayLabel } from '../format.ts';
import { searchSections } from '../services.ts';
import { EventRow } from './EventRow.tsx';
import { ProductCard } from './ProductCard.tsx';
import { ServiceRow } from './ServiceRow.tsx';

const TITLES: Record<SearchEntry['type'], string> = { practice: 'Услуги', event: 'События', product: 'Товары' };

interface Props {
  /** Запрос уже можно искать (не короче двух букв). */
  ready: boolean;
  entries: Wire<SearchEntry>[] | null;
  failed: Error | null;
  /** Чьи находки первыми: вкладка «События» — события, «Услуги» — услуги. */
  first: SearchEntry['type'];
  onOpen: (entry: Wire<SearchEntry>) => void;
}

/** Находки поиска в разделе вместо его витрины: разделами по типу, свой тип первым. */
export function SearchResults({ ready, entries, failed, first, onOpen }: Props) {
  if (!ready) return <p className="note">Ещё пару букв — и поищем в событиях, услугах и товарах мастеров. Окончания и мелкие опечатки не страшны.</p>;
  if (failed) return <div className="state"><b>🌧</b><p>{failed.message}</p></div>;
  if (!entries) return <div className="state"><div className="spinner" role="status" aria-label="Загрузка" /></div>;
  if (!entries.length) return <div className="state"><b>🌿</b><p>Ничего не нашлось. Попробуйте другое слово.</p></div>;
  return (
    <>
      {searchSections(entries, first).map(({ type, entries: list }) => (
        <section key={type}>
          <h2 className="cap">{TITLES[type]} · {list.length}</h2>
          {type === 'practice' ? (
            <div className="group">
              {list.map((entry) => entry.type === 'practice' && (
                <ServiceRow key={entry.practice.id} practice={entry.practice} host={entry.host} onOpen={() => onOpen(entry)} />
              ))}
            </div>
          ) : (
            <div className="feed">
              {list.map((entry) => entry.type === 'event' ? (
                <EventRow
                  key={entry.event.id}
                  href={collectedPath(entry.event.id)}
                  time={[dayLabel(entry.event.starts_at), collectedTime(entry.event.starts_at)].filter(Boolean).join(', ')}
                  title={entry.event.title}
                  sub={[entry.event.place, entry.event.price].filter(Boolean).join(' · ')}
                  cover_url={entry.event.cover_url}
                  icon={topicIcon(entry.event.topic)}
                  topic={topicSlug(entry.event.topic)}
                  onOpen={() => onOpen(entry)}
                />
              ) : entry.type === 'product' && (
                <ProductCard key={entry.product.id} product={entry.product} row onOpen={() => onOpen(entry)} />
              ))}
            </div>
          )}
        </section>
      ))}
    </>
  );
}
