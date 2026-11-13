import { useEffect } from 'react';
import type { CollectedEventItem } from '@yaswami/core';
import { collectedBadges, collectedPath, collectedTime, topicIcon, topicSlug } from '@yaswami/core';
import { track } from '../analytics.ts';
import { EventRow } from '../components/EventRow.tsx';
import { PracticeRow } from '../components/PracticeRow.tsx';
import { dayLabel } from '../format.ts';
import { useHost, usePracticeSignup } from '../hooks/useHosts.ts';
import { useViewed } from '../hooks/useViewed.ts';
import { openExternal } from '../tg.ts';

interface Props {
  id: string;
  city: string;
  onOpenEvent: (event: CollectedEventItem) => void;
  onBack: (() => void) | null;
}

/** Страница организатора или мастера: кто это, что ведёт, ближайшие события и как ему написать. */
export function HostScreen({ id, city, onOpenEvent, onBack }: Props) {
  const { host, loaded, failed } = useHost(id);
  const signUp = usePracticeSignup();
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
      </div>

      {host.summary && <div className="group"><div className="meta"><div className="text">{host.summary}</div></div></div>}

      {host.practices.length > 0 && (
        <>
          <h2>Что ведёт</h2>
          <div className="group">
            {host.practices.map((p) => <PracticeRow key={p.title} practice={p} onSignUp={() => signUp(host, p.title)} />)}
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
      {loaded && !host.events.length && host.upcoming_count === 0 && <p className="note">Ближайших событий нет — напишите, чтобы узнать расписание.</p>}

      {host.photos.length > 0 && (
        <div className="shots" style={{ margin: '16px 16px 0' }}>
          {host.photos.map((p) => (
            <a key={p.url} href={p.source_url} target="_blank" rel="noreferrer" aria-label="Публикация в канале организатора">
              <img src={p.url} alt="" loading="lazy" onError={(e) => { e.currentTarget.parentElement!.hidden = true; }} />
            </a>
          ))}
        </div>
      )}
      <p className="note">Профиль собран из открытых каналов и чатов{host.confirmed ? ' и подтверждён организатором' : ''}.</p>

      <div className="main"><div>
        <button className="cta" onClick={() => { track('host_contacted', { host_id: id }); openExternal(host.contact_url); }}>Написать</button>
        {host.channel_url && (
          <div className="cta-row">
            <button className="cta alt" onClick={() => { track('host_channel_opened', { host_id: id }); openExternal(host.channel_url!); }}>Канал</button>
          </div>
        )}
      </div></div>
    </>
  );
}
