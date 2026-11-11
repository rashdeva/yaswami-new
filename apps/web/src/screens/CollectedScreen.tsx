import { Fragment, useEffect, useRef, useState } from 'react';
import type { CollectedEventItem } from '@yaswami/core';
import { collectedIsPast, collectedPath, collectedWhen, TOPIC_GUIDES } from '@yaswami/core';
import { api, loginUrl } from '../api.ts';
import { openExternal } from '../tg.ts';

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
  const where = [event.place, event.address].filter(Boolean).join(', ');
  // Гид по Topic пишет редакция; у «другого» и у событий, собранных до появления поля, его нет.
  const guide = event.topic ? TOPIC_GUIDES[event.topic] : undefined;
  const level = event.beginner_friendly == null ? null : event.beginner_friendly ? 'Можно без опыта' : 'Нужен опыт';

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
      <div className={`hero${onBack ? '' : ' nb'}`}>
        {onBack && <button className="back" onClick={onBack}>← Все события</button>}
        <div className="emo">{guide?.emoji ?? '📅'}</div>
        <small>{past ? 'Событие прошло' : [city, guide && event.topic].filter(Boolean).join(' · ')}</small>
        <h1>{event.title}</h1>
      </div>

      <div className="group"><div className="meta">
        <div><span>🗓</span><span>{collectedWhen(event.starts_at)}</span></div>
        {where && <div><span>📍</span><span>{where}</span></div>}
        {event.price && <div><span>🎟</span><span>{event.price}</span></div>}
      </div></div>
      {event.description && <div className="group"><div className="meta"><div className="text">{event.description}</div></div></div>}
      {!!event.what_happens?.length && (
        <>
          <h2>Что будет</h2>
          <div className="group"><ol className="steps">{event.what_happens.map((s) => <li key={s}><span>{s}</span></li>)}</ol></div>
        </>
      )}
      {(event.for_whom || level) && (
        <>
          <h2>Для кого</h2>
          <div className="group"><div className="pad">
            {event.for_whom && <p>{event.for_whom}</p>}
            {level && <span className={`badge${event.beginner_friendly ? '' : ' no'}`}>{level}</span>}
          </div></div>
        </>
      )}
      {event.takeaway && (
        <>
          <h2>С чем уйдёшь</h2>
          <div className="group"><div className="pad"><p className="quote">{event.takeaway}</p><p className="from">Со слов организатора</p></div></div>
        </>
      )}
      {guide && (
        <>
          <h2 className="cap">{event.topic} — что это</h2>
          <div className="group">
            <div className="pad"><p>{guide.what}</p><p>{guide.why}</p></div>
            <details><summary>Если идёшь впервые</summary><p>{guide.first}</p></details>
            <details><summary>Кому стоит быть осторожнее</summary><p>{guide.not_for}</p></details>
          </div>
          <p className="note">Гид написала редакция Ясвами — это не обещание организатора.</p>
        </>
      )}
      {event.hosts?.map((host) => (
        <Fragment key={host.name}>
          <h2>Организатор</h2>
          <div className="group"><div className="pad">
            <p>{host.name}</p>
            {host.summary && <p>{host.summary}</p>}
            {host.channel_url && <p><a href={host.channel_url} target="_blank" rel="noreferrer">Канал организатора</a></p>}
            {host.photos.length > 0 && (
              <div className="shots">
                {host.photos.map((src) => <img key={src} src={src} alt="" loading="lazy" onError={(e) => { e.currentTarget.hidden = true; }} />)}
              </div>
            )}
          </div></div>
          {!host.confirmed && <p className="note">Профиль собран автоматически по открытому каналу организатора.</p>}
        </Fragment>
      ))}
      {event.tags.length > 0 && <div className="tags">{event.tags.map((t) => <span key={t}>{t}</span>)}</div>}

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
        </div></div>
      )}
    </>
  );
}
