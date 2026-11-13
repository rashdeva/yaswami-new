import { Drawer } from 'vaul';
import { useEffect, useState } from 'react';
import type { CollectedHost } from '@yaswami/core';
import { collectedIsPast, collectedPath, collectedWhen, TOPIC_GUIDES, topicIcon, topicSlug } from '@yaswami/core';
import { track } from '../analytics.ts';
import { startLogin } from '../api.ts';
import { useCollectedEvent } from '../hooks/useCollectedEvent.ts';
import { useScrolledPast } from '../hooks/useScrolledPast.ts';
import { openExternal } from '../tg.ts';
import { collectedLink } from '../format.ts';
import { shareLink } from '../share.ts';
import { About } from '../components/About.tsx';
import { GuestRow } from '../components/GuestRow.tsx';
import { ShareButton } from '../components/ShareButton.tsx';

interface Props {
  id: string;
  city: string;
  /** Человек вошёл: его «Записаться» можно зафиксировать. */
  authed: boolean;
  /** Не вошёл, но на сайте можно войти через Telegram. */
  canLogin: boolean;
  signedUp: boolean;
  /** Событие можно подтвердить как своё: контактом в анонсе указан этот человек. */
  onClaim: (() => Promise<void>) | null;
  /** Организатор уже подтвердил событие: запись идёт через событие Ясвами. */
  onOpenEvent: (eventId: string) => void;
  onBack: (() => void) | null;
  toast: (text: string) => void;
}

/** Событие, собранное из открытого канала. Записывает на него организатор: мы фиксируем намерение и ведём к нему. */
export function CollectedScreen({ id, city, authed, canLogin, signedUp, onClaim, onOpenEvent, onBack, toast }: Props) {
  const [claiming, setClaiming] = useState(false);
  const [hostOpen, setHostOpen] = useState<CollectedHost | null>(null);
  const { event, failed, signUp: recordSignUp } = useCollectedEvent(id, authed, toast);
  const [watch, barShown] = useScrolledPast();

  useEffect(() => {
    if (event) document.title = `${event.title} — ${collectedWhen(event.starts_at)}, ${city}`;
  }, [event, city]);

  if (!event) {
    return failed ? (
      <div className="state">
        <b>🫥</b>
        <p>{failed.message}</p>
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
  const cover = !!(event.cover_url || event.video_url);

  // Кнопки сначала лежат в шапке; когда её прокрутили, их копия выезжает снизу.
  const actions = past ? null : (
    <div className="cta-row">
      <ShareButton onClick={() => shareLink(collectedLink(id), `${event.title}\n${collectedWhen(event.starts_at)}, ${city}`, toast)} />
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
    </div>
  );

  function signUp() {
    track('signup_clicked', { collected_event_id: id, authed });
    if (event!.claimed_event_id) return onOpenEvent(event!.claimed_event_id);
    if (!authed && canLogin) {
      startLogin(`${collectedPath(id)}?signup=1`);
      return;
    }
    // Запись уходит в фоне, а ссылка открывается сразу: иначе браузер сочтёт новую вкладку всплывающим окном.
    if (authed && !signedUp) recordSignUp();
    track('host_contacted', { collected_event_id: id });
    openExternal(event!.signup_url);
  }

  return (
    <>
      <div className={`hero${onBack ? '' : ' nb'}${cover ? ' cov' : ''}`} data-topic={topicSlug(event.topic)}>
        {/* Ролик без звука и по кругу: название и время поверх пишет сама шапка, в ролике текста нет. */}
        {event.video_url
          ? <video className="bg" src={event.video_url} poster={event.cover_url ?? undefined} autoPlay muted loop playsInline />
          : event.cover_url && <img className="bg" src={event.cover_url} alt="" />}
        {cover && <img className="mark" src="/mark.svg" alt="" />}
        {onBack && <button className="back" onClick={onBack}>← Все события</button>}
        {!cover && <img className="emo" src={topicIcon(event.topic)} alt="" />}
        <div className="sum">
          {past && <small>Событие прошло</small>}
          <h1>{event.title}</h1>
          <p className="when">{collectedWhen(event.starts_at)}</p>
          <p className="where">📍 {where || city}</p>
        </div>
        {actions && <div className="acts" ref={watch}>{actions}</div>}
      </div>

      {event.price && <div className="group"><div className="meta"><div><span>🎟</span><span>{event.price}</span></div></div></div>}
      {event.description && <div className="group"><div className="meta"><div className="text">{event.description}</div></div></div>}
      {(event.popular || event.tags.length > 0) && (
        <p className="taglist">
          {event.popular && <span className="badge hot">Популярное</span>}
          {event.tags.map((t) => <span key={t}>#{t}</span>)}
        </p>
      )}
      <About topic={event.topic} what_happens={event.what_happens} for_whom={event.for_whom} beginner_friendly={event.beginner_friendly}
        takeaway={event.takeaway} guide={guide} guideNote="Гид написала редакция Ясвами — это не обещание организатора." />
      <h2>Участники</h2>
      <div className="group">
        {event.hosts?.map((h) => (
          <button key={h.name} className="plain" onClick={() => setHostOpen(h)}>
            <GuestRow name={h.name} photo={h.photo_url} label="организатор ›" />
          </button>
        ))}
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
        <button className="quiet" onClick={() => { startLogin(collectedPath(id)); }}>Вы организатор? Войдите, чтобы принимать записи здесь</button>
      )}

      {actions && <div className="main" data-off={!barShown || undefined} inert={!barShown}><div>{actions}</div></div>}
      <Drawer.Root open={!!hostOpen} onOpenChange={(o) => { if (!o) setHostOpen(null); }}>
        <Drawer.Portal>
          <Drawer.Overlay className="drawer-overlay" />
          <Drawer.Content className="drawer" aria-describedby={undefined}>
            <Drawer.Handle className="drawer-handle" />
            <Drawer.Title className="lead">Канал организатора</Drawer.Title>
            {hostOpen && (
              <>
                <p className="who">
                  {/* фото нет или скрыто настройками приватности — Telegram отвечает 404, тогда просто имя */}
                  <img className="ava" src={hostOpen.photo_url} alt="" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                  {hostOpen.name}
                </p>
                {hostOpen.summary && <p>{hostOpen.summary}</p>}
                {hostOpen.photos.length > 0 && (
                  <div className="shots" data-vaul-no-drag>
                    {hostOpen.photos.map((p) => (
                      <a key={p.url} href={p.source_url} target="_blank" rel="noreferrer" aria-label="Публикация в канале организатора">
                        <img src={p.url} alt="" loading="lazy" onError={(e) => { e.currentTarget.parentElement!.hidden = true; }} />
                      </a>
                    ))}
                  </div>
                )}
                {hostOpen.channel_url && <button className="cta alt" onClick={() => { track('host_channel_opened', { collected_event_id: id }); openExternal(hostOpen.channel_url!); }}>Перейти в канал</button>}
              </>
            )}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  );
}
