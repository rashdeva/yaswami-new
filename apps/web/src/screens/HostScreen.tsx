import { useEffect } from 'react';
import { useTopics } from '../hooks/useTopics.ts';
import type { CollectedEventItem, ProductItem } from '@yaswami/core';
import { collectedBadges, collectedPath, collectedTime, topicIcon, topicSlug } from '@yaswami/core';
import { track } from '../analytics.ts';
import { EventRow } from '../components/EventRow.tsx';
import { PracticeRow } from '../components/PracticeRow.tsx';
import { ProductCard } from '../components/ProductCard.tsx';
import { dayLabel, reputation } from '../format.ts';
import { useHost, usePracticeSheet } from '../hooks/useHosts.ts';
import { PracticeSheet } from '../components/PracticeSheet.tsx';
import { HostFeedback } from './HostFeedback.tsx';
import { useViewed } from '../hooks/useViewed.ts';
import { openExternal } from '../tg.ts';

interface Props {
  id: string;
  city: string;
  onOpenEvent: (event: CollectedEventItem) => void;
  onOpenProduct: (product: ProductItem) => void;
  onBack: (() => void) | null;
  /** Отзывы: чья страница, вошёл ли человек, как войти и открыть ли форму сразу (ссылка мастера «оставьте отзыв»). */
  feedback: { own: boolean; authed: boolean; onLogin: (() => void) | null; openForm: boolean };
}

/** Страница организатора или мастера: кто это, что ведёт, что продаёт, ближайшие события и как ему написать. */
export function HostScreen({ id, city, onOpenEvent, onOpenProduct, onBack, feedback }: Props) {
  useTopics(); // иконки и цвета тем — из базы: перерисоваться, когда пришли
  const { host, loaded, failed } = useHost(id);
  const sheet = usePracticeSheet();
  useViewed('host_viewed', id);
  useEffect(() => { if (host) document.title = `${host.name} — ${city}, Я с вами`; }, [host, city]);

  if (!host) {
    return failed ? (
      <div className="state">
        <b>🫥</b>
        <p>{failed.message}</p>
        {onBack && <button className="chip" onClick={onBack}>← Все услуги</button>}
      </div>
    ) : (
      <div className="state"><div className="spinner" role="status" aria-label="Загрузка" /></div>
    );
  }

  const topic = host.topics[0];
  return (
    <>
      <div className={`hero${onBack ? '' : ' nb'}`} data-topic={topicSlug(topic)}>
        {onBack && <button className="back" onClick={onBack}>← Все услуги</button>}
        {/* фото нет или скрыто — Telegram отвечает 404, тогда иконка темы */}
        <img className="emo" src={host.photo_url} alt="" referrerPolicy="no-referrer" style={{ borderRadius: '50%', objectFit: 'cover' }}
          onError={(e) => { e.currentTarget.src = topicIcon(topic); e.currentTarget.style.borderRadius = '0'; }} />
        <small>{[city, ...host.topics].join(' · ')}</small>
        <h1>{host.name}</h1>
        {reputation(host.feedback) && <small className="rating">{reputation(host.feedback)}</small>}
      </div>

      {host.summary && <div className="group"><div className="meta"><div className="text">{host.summary}</div></div></div>}

      {host.practices.length > 0 && (
        <>
          <h2>Что ведёт</h2>
          <div className="group">
            {host.practices.map((p) => <PracticeRow key={p.id} practice={p} onOpen={() => sheet.show({ practice: p, host })} />)}
          </div>
        </>
      )}

      {host.products.length > 0 && (
        <>
          <h2>Товары</h2>
          <div className="products">
            {host.products.map((p) => <ProductCard key={p.id} product={p} onOpen={() => onOpenProduct(p)} />)}
          </div>
        </>
      )}

      {host.events.length > 0 && (
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
      {loaded && !host.events.length && !host.products.length && host.upcoming_count === 0 && <p className="note">Ближайших событий нет — напишите, чтобы узнать расписание.</p>}

      {loaded && <HostFeedback host={host} {...feedback} />}

      {host.photos.length > 0 && (
        <div className="shots" style={{ margin: '16px 16px 0' }}>
          {host.photos.map((p) => (
            <a key={p.url} href={p.source_url} target="_blank" rel="noreferrer" aria-label="Публикация в канале организатора">
              <img src={p.url} alt="" loading="lazy" onError={(e) => { e.currentTarget.parentElement!.hidden = true; }} />
            </a>
          ))}
        </div>
      )}
      <p className="note">Профиль собран из открытых каналов и чатов{host.instagram_handle ? ' и Instagram' : ''}{host.confirmed ? ' и подтверждён организатором' : ''}.</p>

      {/* Мастер в шторке — этот же: нажатие на него просто закрывает шторку. */}
      <PracticeSheet open={sheet.open} onClose={sheet.close} onPick={sheet.pick} onSignUp={sheet.signUp} onOpenHost={sheet.close} />

      <div className="main"><div>
        <button className="cta" onClick={() => { track('host_contacted', { host_id: id }); openExternal(host.contact_url); }}>Написать</button>
        {(host.channel_url || host.instagram_handle) && (
          <div className="cta-row">
            {host.channel_url && <button className="cta alt" onClick={() => { track('host_channel_opened', { host_id: id }); openExternal(host.channel_url!); }}>Канал</button>}
            {host.instagram_handle && <button className="cta alt" onClick={() => { track('host_instagram_opened', { host_id: id }); openExternal(`https://instagram.com/${host.instagram_handle}`); }}>Instagram</button>}
          </div>
        )}
      </div></div>
    </>
  );
}
