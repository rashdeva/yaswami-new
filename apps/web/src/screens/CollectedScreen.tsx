import { useEffect, useRef, useState } from 'react';
import type { CollectedEventItem } from '@yaswami/core';
import { collectedIsPast, collectedPath, collectedWhen } from '@yaswami/core';
import { api, loginUrl } from '../api.ts';
import { haptic, openExternal } from '../tg.ts';

interface Props {
  id: string;
  city: string;
  initial?: CollectedEventItem;
  /** Человек вошёл: его «Записаться» можно зафиксировать. */
  authed: boolean;
  /** Не вошёл, но на сайте можно войти через Telegram. */
  canLogin: boolean;
  signedUp: boolean;
  onSignedUp: (id: string) => void;
  onBack: (() => void) | null;
  toast: (text: string) => void;
}

/** Событие, собранное из открытого канала. Записывает на него организатор: мы фиксируем намерение и ведём к нему. */
export function CollectedScreen({ id, city, initial, authed, canLogin, signedUp, onSignedUp, onBack, toast }: Props) {
  const [event, setEvent] = useState<CollectedEventItem | null>(initial ?? null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!initial) api.collectedEvent(id).then(setEvent, (e: Error) => setFailed(e.message));
  }, [id, initial]);

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

  function signUp() {
    haptic.tap();
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
        <div className="emo">📅</div>
        <small>{past ? 'Событие прошло' : city}</small>
        <h1>{event.title}</h1>
      </div>

      <div className="group"><div className="meta">
        <div><span>🗓</span><span>{collectedWhen(event.starts_at)}</span></div>
        {where && <div><span>📍</span><span>{where}</span></div>}
        {event.price && <div><span>🎟</span><span>{event.price}</span></div>}
      </div></div>
      {event.description && <div className="group"><div className="meta"><div className="text">{event.description}</div></div></div>}
      {event.tags.length > 0 && <div className="tags">{event.tags.map((t) => <span key={t}>{t}</span>)}</div>}

      <p className="note">
        {signedUp
          ? 'Вы отметили, что пойдёте. Место подтверждает организатор — напишите ему.'
          : 'Событие нашли в открытом канале. Записывает организатор: мы откроем чат с ним и готовым сообщением.'}
        {' '}<a href={event.source_url} target="_blank" rel="noreferrer">Исходный анонс</a>
      </p>

      {!past && (
        <div className="main"><div>
          <button className="cta" onClick={signUp}>{signedUp ? 'Написать организатору' : 'Записаться'}</button>
        </div></div>
      )}
    </>
  );
}
