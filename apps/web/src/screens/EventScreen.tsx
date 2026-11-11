import { useCallback, useEffect, useState } from 'react';
import type { Event, RsvpStatus } from '@yaswami/core';
import { TEMPLATES } from '@yaswami/core';
import type { EventData } from '../api.ts';
import { api } from '../api.ts';
import { hue, kindIcon, when } from '../format.ts';
import { haptic, startParam, startRef } from '../tg.ts';
import { shareEvent } from '../share.ts';
import { About } from './About.tsx';
import { GuestRow } from './GuestRow.tsx';

const ANSWERS: [RsvpStatus, string][] = [['approved', 'Пойду'], ['maybe', 'Думаю'], ['declined', 'Не пойду']];
const GUEST_LABEL = { approved: 'пойдёт', maybe: 'думает', declined: 'не пойдёт', waitlist: 'в листе ожидания' } as const;

interface Props {
  id: string;
  initial?: EventData;
  /** Кто смотрит: его id уходит в ссылку «Позвать друзей». */
  userId?: number;
  onBack: (() => void) | null;
  onKind: (kind: Event['kind']) => void;
  toast: (text: string) => void;
  onChanged: () => void;
  /** Организатору: открыть экран «Редактировать». */
  onEdit: (view: EventData) => void;
}

export function EventScreen({ id, initial, userId, onBack, onKind, toast, onChanged, onEdit }: Props) {
  const [view, setView] = useState<EventData | null>(initial ?? null);
  const [failed, setFailed] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  const load = useCallback(
    () => api.event(id).then((v) => { setView(v); setFailed(null); }, (e: Error) => setFailed(e.message)),
    [id],
  );
  useEffect(() => {
    void load();
    // Ответы других гостей подтягиваем, когда человек возвращается в приложение.
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  // Заход фиксируем один раз на открытие; кто позвал — из ссылки, если открыли именно это событие.
  useEffect(() => { void api.visit(id, id === startParam ? startRef : undefined).catch(() => {}); }, [id]);

  const kind = view?.event.kind;
  useEffect(() => { if (kind) onKind(kind); }, [kind, onKind]);

  if (!view) {
    return failed ? (
      <div className="state">
        <b>🫥</b>
        <p>{failed}</p>
        {onBack && <button className="chip" onClick={onBack}>← Мои события</button>}
      </div>
    ) : (
      <div className="state"><div className="spinner" role="status" aria-label="Загрузка" /></div>
    );
  }

  const { event, ticket_types: types, guests, guest_counts: counts, me, is_host } = view;
  const template = TEMPLATES[event.kind];
  const open = event.status === 'published';
  const selected = picked ?? me?.event_ticket_type_id ?? (types.length === 1 ? types[0]!.id : null);
  const taken = (typeId: string) =>
    guests.filter((g) => g.approval_status === 'approved' && g.event_ticket_type_id === typeId).reduce((n, g) => n + 1 + g.plus_ones, 0);

  async function respond(approval_status: RsvpStatus, ticketId = selected) {
    if (approval_status === 'approved' && !ticketId) {
      haptic.error();
      return toast('Сначала выберите билет');
    }
    setPending(true);
    try {
      setView(await api.rsvp(id, { approval_status, ...(approval_status === 'approved' && ticketId ? { event_ticket_type_id: ticketId } : {}) }));
      haptic.success();
      onChanged();
    } catch (e) {
      haptic.error();
      toast((e as Error).message);
      void load(); // мест могло не остаться — показываем свежие числа
    } finally {
      setPending(false);
    }
  }

  function pickTicket(ticketId: string) {
    setPicked(ticketId);
    if (me?.approval_status === 'approved') void respond('approved', ticketId); // уже идёт — меняем билет сразу
  }

  return (
    <>
      <div className={`hero${onBack ? '' : ' nb'}`}>
        {onBack && <button className="back" onClick={onBack}>← Мои события</button>}
        <img className="emo" src={kindIcon(event.kind)} alt="" />
        <small>{event.status === 'cancelled' ? 'Отменено' : event.status === 'draft' ? 'Черновик' : template.label}</small>
        <h1>{event.name}</h1>
      </div>

      <div className="group"><div className="meta">
        <div><span>🗓</span><span>{when(event.start_at, event.timezone)}</span></div>
        {event.geo_address_json && <div><span>📍</span><span>{event.geo_address_json.address}</span></div>}
        {event.meeting_url && <div><span>🔗</span><a href={event.meeting_url} target="_blank" rel="noreferrer">{event.meeting_url.replace(/^https?:\/\//, '')}</a></div>}
        {types.length === 1 && types[0]!.price_text && <div><span>🎟</span><span>{types[0]!.price_text}</span></div>}
      </div></div>
      {event.description && <div className="group"><div className="meta"><div className="text">{event.description}</div></div></div>}

      <About topic={event.topic} what_happens={event.what_happens} for_whom={event.for_whom} beginner_friendly={event.beginner_friendly}
        takeaway={event.takeaway} guide={event.guide} />

      {!is_host && open && (
        <>
          {types.length > 1 && (
            <>
              <h2>Билет</h2>
              <div className="group" role="radiogroup" aria-label="Тип билета">
                {types.map((t) => {
                  const left = t.max_capacity === null ? null : Math.max(0, t.max_capacity - taken(t.id));
                  const mine = me?.approval_status === 'approved' && me.event_ticket_type_id === t.id;
                  const details = [t.price_text, t.description, left === null ? null : left > 0 ? `осталось ${left}` : 'мест нет'].filter(Boolean).join(' · ');
                  return (
                    <button key={t.id} className="row ticket" role="radio" aria-label={t.name} aria-checked={selected === t.id} disabled={pending || (left === 0 && !mine)} onClick={() => pickTicket(t.id)}>
                      <div>{t.name}{details && <small>{details}</small>}</div>
                      <i />
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {me?.approval_status === 'waitlist' && <p className="note">Вы в листе ожидания: напишем, когда освободится место.</p>}
        </>
      )}

      <div className="stats">
        <div className="stat"><b>{counts.approved}{event.max_capacity !== null && <span> / {event.max_capacity}</span>}</b><span>пойдут</span></div>
        <div className="stat"><b>{counts.declined}</b><span>не пойдут</span></div>
        <div className="stat"><b>{counts.maybe}</b><span>думают</span></div>
      </div>

      <h2>Гости</h2>
      <div className="group">
        <GuestRow name={view.host.first_name} photo={view.host.user_photo_url} label="организатор">{is_host && ' (вы)'}</GuestRow>
        {guests.length > 0 ? guests.map((g, i) => (
          <GuestRow key={i} name={g.user_first_name} photo={g.user_photo_url} label={GUEST_LABEL[g.approval_status]}>
            {g.is_me && ' (вы)'}{g.plus_ones > 0 && ` +${g.plus_ones}`}
          </GuestRow>
        )) : (
          <div className="guest empty">{is_host ? 'Пока никто не ответил. Отправьте событие в чат — ответы появятся здесь.' : 'Пока никто не ответил. Будьте первым.'}</div>
        )}
      </div>

      {view.feedback.count > 0 && (
        <>
          <h2>Отзывы · {view.feedback.average!.toFixed(1).replace('.', ',')} из 5 ({view.feedback.count})</h2>
          {view.feedback.items.length > 0 && (
            <div className="group">
              {view.feedback.items.map((f, i) => (
                <GuestRow key={i} name={f.user_first_name} photo={null} label={'★'.repeat(f.rating)}>
                  {f.comment && <>: {f.comment}</>}
                </GuestRow>
              ))}
            </div>
          )}
        </>
      )}

      <div className="main"><div>
        {!is_host && open && (
          <div className="rsvp bar" role="group" aria-label="Ваш ответ">
            {ANSWERS.map(([status, label]) => (
              <button key={status} className={status === 'approved' ? 'go' : undefined} aria-pressed={me?.approval_status === status} disabled={pending} onClick={() => void respond(status)}>
                {label}
              </button>
            ))}
          </div>
        )}
        {is_host ? (
          <div className="cta-row">
            <button className="cta alt" onClick={() => onEdit(view)}>Редактировать</button>
            <button className="cta" onClick={() => shareEvent(view.event, userId, toast)}>Поделиться</button>
          </div>
        ) : (
          <button className={open ? 'cta alt' : 'cta'} onClick={() => shareEvent(view.event, userId, toast)}>Поделиться</button>
        )}
      </div></div>
    </>
  );
}
