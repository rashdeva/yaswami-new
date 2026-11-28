// Страница мастера без нижней панели: шапка, о себе, что ведёт, товары, события, отзывы и фото.
// Одна на двоих: чужая страница организатора (HostScreen) и мой профиль (ProfileScreen) — так профиль выглядит так же,
// как его видят другие.
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { CollectedEventItem, HostItem, ProductItem } from '@yaswami/core';
import { collectedBadges, collectedPath, collectedTime, topicIcon, topicSlug } from '@yaswami/core';
import { EventRow } from '../components/EventRow.tsx';
import { MediaViewer } from '../components/MediaViewer.tsx';
import { PracticeRow } from '../components/PracticeRow.tsx';
import { PracticeSheet } from '../components/PracticeSheet.tsx';
import { ProductCard } from '../components/ProductCard.tsx';
import { dayLabel, reputation } from '../format.ts';
import { usePracticeSheet } from '../hooks/useHosts.ts';
import { useTopics } from '../hooks/useTopics.ts';
import { HostFeedback } from './HostFeedback.tsx';

interface Props {
  host: HostItem;
  /** Страница догрузилась: до этого `events` пустой не потому, что событий нет. */
  loaded: boolean;
  city: string;
  /** Человек смотрит собственную страницу: вместо «Оставить отзыв» — ссылка для клиентов и бонус за отзыв. */
  own: boolean;
  /** Слева сверху в шапке: «назад». */
  back?: ReactNode;
  /** Справа сверху в шапке: «поделиться», «настройки». */
  tools?: ReactNode;
  /** Под «о себе»: у моего профиля — «Поделиться профилем». */
  lead?: ReactNode;
  /** Показывать «Ближайшие события». В моём профиле их заменяют «Мои события». */
  events: boolean;
  onOpenEvent: (event: CollectedEventItem) => void;
  onOpenProduct: (product: ProductItem) => void;
}

export function HostProfile({ host, loaded, city, own, back, tools, lead, events, onOpenEvent, onOpenProduct }: Props) {
  useTopics(); // иконки и цвета тем — из базы: перерисоваться, когда пришли
  const sheet = usePracticeSheet();
  const [viewing, setViewing] = useState<number | null>(null);
  const topic = host.topics[0];
  return (
    <>
      <div className={`hero${back ? '' : ' nb'}`} data-topic={topicSlug(topic)}>
        {back}
        {tools && <div className="tools">{tools}</div>}
        {/* фото нет или скрыто — Telegram отвечает 404, тогда иконка темы */}
        <img className="emo face" src={host.photo_url} alt="" referrerPolicy="no-referrer" style={{ borderRadius: '50%', objectFit: 'cover' }}
          onError={(e) => { e.currentTarget.src = topicIcon(topic); e.currentTarget.style.borderRadius = '0'; }} />
        <small>{[city, ...host.topics].join(' · ')}</small>
        <h1>{host.name}</h1>
        {reputation(host.feedback) && <small className="rating">{reputation(host.feedback)}</small>}
      </div>

      {host.summary && <div className="group"><div className="meta"><div className="text">{host.summary}</div></div></div>}
      {lead}

      {host.practices.length > 0 && (
        <>
          <h2>{own ? 'Мои услуги' : 'Что ведёт'}</h2>
          <div className="group">
            {host.practices.map((p) => <PracticeRow key={p.id} practice={p} onOpen={() => sheet.show({ practice: p, host })} />)}
          </div>
        </>
      )}

      {host.products.length > 0 && (
        <>
          <h2>{own ? 'Мои товары' : 'Товары'}</h2>
          <div className="products">
            {host.products.map((p) => <ProductCard key={p.id} product={p} onOpen={() => onOpenProduct(p)} />)}
          </div>
        </>
      )}

      {events && host.events.length > 0 && (
        <>
          <h2>Ближайшие события</h2>
          <div className="feed">
            {host.events.map((e) => (
              <EventRow key={e.id} href={collectedPath(e.id)} time={collectedTime(e.starts_at)} title={e.title}
                sub={[dayLabel(e.starts_at), e.place, e.price].filter(Boolean).join(' · ')} cover_url={e.cover_url} icon={topicIcon(e.topic)}
                topic={topicSlug(e.topic)} badges={collectedBadges(e)} onOpen={() => onOpenEvent(e)} />
            ))}
          </div>
        </>
      )}
      {events && loaded && !host.events.length && !host.products.length && host.upcoming_count === 0 && <p className="note">Ближайших событий нет — напишите, чтобы узнать расписание.</p>}

      {loaded && <HostFeedback host={host} own={own} />}

      {host.photos.length > 0 && (
        <div className="shots" style={{ margin: '16px 16px 0' }}>
          {host.photos.map((p, i) => (
            <button key={p.url} onClick={() => setViewing(i)} aria-label="Открыть фото">
              <img src={p.url} alt="" loading="lazy" onError={(e) => { e.currentTarget.parentElement!.hidden = true; }} />
            </button>
          ))}
        </div>
      )}
      {viewing !== null && <MediaViewer items={host.photos.map((p) => ({ type: 'photo', url: p.url }))} start={viewing} onClose={() => setViewing(null)} />}
      <p className="note">Профиль собран из открытых каналов и чатов{host.instagram_handle ? ' и Instagram' : ''}{host.confirmed ? ' и подтверждён организатором' : ''}.</p>

      {/* Мастер в шторке — этот же: нажатие на него просто закрывает шторку. */}
      <PracticeSheet open={sheet.open} onClose={sheet.close} onPick={sheet.pick} onSignUp={sheet.signUp} onOpenHost={sheet.close} />
    </>
  );
}
