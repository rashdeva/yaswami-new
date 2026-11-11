import { Fragment, useEffect, useRef, useState } from 'react';
import type { CollectedEventItem } from '@yaswami/core';
import { collectedIsPast, collectedPath, collectedWhen, TOPIC_GUIDES, topicIcon } from '@yaswami/core';
import { api, loginUrl } from '../api.ts';
import { openExternal } from '../tg.ts';
import { shareLink } from '../share.ts';
import { About } from './About.tsx';
import { GuestRow } from './GuestRow.tsx';

interface Props {
  id: string;
  city: string;
  initial?: CollectedEventItem;
  /** Человек вошёл: его «Записаться» можно зафиксировать. */
  authed: boolean;
  /** Не вошёл, но на сайте можно войти через Telegram. */
  canLogin: boolean;
  signedUp: boolean;
  /** Событие можно подтвердить как своё: контактом в анонсе указан этот человек. */
  onClaim: (() => Promise<void>) | null;
  /** Организатор уже подтвердил событие: запись идёт через событие Ясвами. */
  onOpenEvent: (eventId: string) => void;
  onSignedUp: (id: string) => void;
  onBack: (() => void) | null;
  toast: (text: string) => void;
}

/** Событие, собранное из открытого канала. Записывает на него организатор: мы фиксируем намерение и ведём к нему. */
export function CollectedScreen({ id, city, initial, authed, canLogin, signedUp, onClaim, onOpenEvent, onSignedUp, onBack, toast }: Props) {
  const [claiming, setClaiming] = useState(false);
  const [event, setEvent] = useState<CollectedEventItem | null>(initial ?? null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    // Запрашиваем и при готовой карточке из списка: профиль организатора есть только в ответе на одно событие.
    api.collectedEvent(id).then(setEvent, (e: Error) => setFailed(e.message));
  }, [id]);

  // Заход вошедшего человека: по ним организатор потом увидит свою аудиторию. Анонимных не считаем.
  useEffect(() => { if (authed) void api.visitCollected(id).catch(() => {}); }, [id, authed]);

  useEffect(() => {
    if (event) document.title = `${event.title} — ${collectedWhen(event.starts_at)}, ${city}`;
  }, [event, city]);

  // Вернулись после входа, начатого кнопкой «Записаться»: фиксируем запись, к организатору человек перейдёт
  // вторым нажатием — открыть новую вкладку без нажатия браузер не даст.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || !authed || !new URLSearchParams(location.search).has('signup')) return;
    resumed.current = true;
    history.replaceState(null, '', collectedPath(id));
    api.signUp(id).then(() => {
      onSignedUp(id);
      toast('Вы записаны. Напишите организатору, чтобы подтвердить место');
    }, (e: Error) => toast(e.message));
  }, [authed, id, onSignedUp, toast]);

  if (!event) {
    return failed ? (
      <div className="state">
        <b>🫥</b>
        <p>{failed}</p>
        {onBack && <button className="chip" onClick={onBack}>← Все события</button>}
      </div>
    ) : (
      <div className="state"><div className="spinner" role="status" aria-label="Загрузка" /></div>
    );
  }

  const past = collectedIsPast(event);
  const host = event.hosts?.[0];
  const where = [event.place, event.address].filter(Boolean).join(', ');
  // Гид по Topic пишет редакция; у «другого» и у событий, собранных до появления поля, его нет.
  const guide = event.topic ? TOPIC_GUIDES[event.topic] : undefined;

  function signUp() {
    if (event!.claimed_event_id) return onOpenEvent(event!.claimed_event_id);
    if (!authed && canLogin) {
      location.href = loginUrl(`${collectedPath(id)}?signup=1`);
      return;
    }
    // Запись уходит в фоне, а ссылка открывается сразу: иначе браузер сочтёт новую вкладку всплывающим окном.
    if (authed && !signedUp) void api.signUp(id).then(() => onSignedUp(id), () => {});
    openExternal(event!.signup_url);
  }

  return (
    <>
      <div className={`hero${onBack ? '' : ' nb'}${event.cover_url ? ' cov' : ''}`}>
        {event.cover_url && <img className="bg" src={event.cover_url} alt="" />}
        {onBack && <button className="back" onClick={onBack}>← Все события</button>}
        {!event.cover_url && <img className="emo" src={topicIcon(event.topic)} alt="" />}
        <small>{past ? 'Событие прошло' : [city, guide && event.topic].filter(Boolean).join(' · ')}</small>
        <h1>{event.title}</h1>
        {(event.popular || event.tags.length > 0) && (
          <div className="tags">
            {event.popular && <span className="hot">Популярное</span>}
            {event.tags.map((t) => <span key={t}>{t}</span>)}
          </div>
        )}
      </div>

      <div className="group"><div className="meta">
        <div><span>🗓</span><span>{collectedWhen(event.starts_at)}</span></div>
        {where && <div><span>📍</span><span>{where}</span></div>}
        {event.price && <div><span>🎟</span><span>{event.price}</span></div>}
        {(!!event.views || !!event.reactions) && (
          <div><span>👀</span><span>{[event.views && `${event.views.toLocaleString('ru')} просмотров`, event.reactions && `реакций: ${event.reactions}`].filter(Boolean).join(' · ')} у анонса</span></div>
        )}
      </div></div>
      {event.description && <div className="group"><div className="meta"><div className="text">{event.description}</div></div></div>}
      <About topic={event.topic} what_happens={event.what_happens} for_whom={event.for_whom} beginner_friendly={event.beginner_friendly}
        takeaway={event.takeaway} guide={guide} guideNote="Гид написала редакция Ясвами — это не обещание организатора." />
      {event.hosts?.map((host) => (
        <Fragment key={host.name}>
          <h2>Организатор</h2>
          <div className="group"><div className="pad">
            <p className="who">
              {/* фото нет или скрыто настройками приватности — Telegram отвечает 404, тогда просто имя */}
              <img className="ava" src={host.photo_url} alt="" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              {host.name}
            </p>
            {host.summary && <p>{host.summary}</p>}
            {host.photos.length > 0 && (
              <div className="shots">
                {host.photos.map((p) => (
                  <a key={p.url} href={p.source_url} target="_blank" rel="noreferrer" aria-label="Публикация в канале организатора">
                    <img src={p.url} alt="" loading="lazy" onError={(e) => { e.currentTarget.parentElement!.hidden = true; }} />
                  </a>
                ))}
              </div>
            )}
          </div></div>
        </Fragment>
      ))}
      <h2>Участники</h2>
      <div className="group">
        {host && <GuestRow name={host.name} photo={host.photo_url} label="организатор" />}
        {!!event.signups_count && <div className="guest empty">Интересуются: {event.signups_count}. Записывает организатор.</div>}
      </div>

      <p className="note">
        {event.claimed_event_id
          ? 'Организатор принимает записи в Ясвами: ответьте «Пойду» — и вы в списке гостей.'
          : signedUp
            ? 'Вы отметили, что пойдёте. Место подтверждает организатор — напишите ему.'
            : 'Событие нашли в открытом канале. Записывает организатор: мы откроем чат с ним и готовым сообщением.'}
        {' '}<a href={event.source_url} target="_blank" rel="noreferrer">Исходный анонс</a>
      </p>
      {!event.claimed_event_id && !authed && canLogin && (
        <button className="quiet" onClick={() => { location.href = loginUrl(collectedPath(id)); }}>Вы организатор? Войдите, чтобы принимать записи здесь</button>
      )}

      {!past && (
        <div className="main"><div>
          {onClaim ? (
            <button
              className="cta"
              disabled={claiming}
              onClick={() => { setClaiming(true); void onClaim().finally(() => setClaiming(false)); }}
            >
              {claiming ? 'Минуту…' : 'Это моё событие'}
            </button>
          ) : (
            <button className="cta" onClick={signUp}>{signedUp && !event.claimed_event_id ? 'Написать организатору' : 'Записаться'}</button>
          )}
          <div className="cta-row">
            {host?.channel_url && <button className="cta alt" onClick={() => openExternal(host.channel_url!)}>Перейти в канал</button>}
            <button className="cta alt" onClick={() => shareLink(location.origin + collectedPath(id), `${event.title}\n${collectedWhen(event.starts_at)}, ${city}`, toast)}>Поделиться</button>
          </div>
        </div></div>
      )}
    </>
  );
}
