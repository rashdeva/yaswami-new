// Профиль: кто я, город, темы, уведомления бота и — у вошедшего — мои события (ниже, `children`).
// Гостю без входа — город и приглашение войти.
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import type { Notification } from '@yaswami/core';
import { topicIcon } from '@yaswami/core';
import { Avatar } from '../components/Avatar.tsx';
import { useNotifications } from '../hooks/useNotifications.ts';
import { useCity } from '../hooks/useSession.ts';
import { useTopicSubscription } from '../hooks/useTopicSubscription.ts';
import { useTopics } from '../hooks/useTopics.ts';
import { useViewed } from '../hooks/useViewed.ts';

/** Уведомления и для кого они: организаторские показываем только организатору. */
const NOTIFICATIONS: { kind: Notification; title: string; host?: boolean }[] = [
  { kind: 'topic_digest', title: 'Новые события по моим темам' },
  { kind: 'rsvp_confirmed', title: 'Подтверждение записи' },
  { kind: 'feedback_request', title: 'Вопрос «как прошло» после события' },
  { kind: 'guest_registered', title: 'Новые гости на моих событиях', host: true },
  { kind: 'feedback_received', title: 'Отзывы на мои события', host: true },
];

interface Props {
  /** Имя вошедшего; null — гость без входа. */
  name: string | null;
  /** Организатор: показать и его уведомления. */
  host: boolean;
  /** Гостю: войти. null — войти здесь нельзя (вне Telegram без настроенного входа). */
  onLogin: (() => void) | null;
  /** Кнопка «назад» на странице; null — её рисует Telegram. */
  onBack: (() => void) | null;
  /** Мои события — у вошедшего. */
  children?: ReactNode;
}

export function ProfileScreen({ name, host, onLogin, onBack, children }: Props) {
  const city = useCity();
  useViewed('profile_opened');
  useEffect(() => { document.title = 'Профиль — Я с вами'; }, []);
  return (
    <>
      <div className="top">
        {onBack && <button className="chip" onClick={onBack}>← Все события</button>}
        <div className="profile-head">
          <Avatar big />
          <h1>{name ?? 'Гость'}</h1>
        </div>
      </div>

      <h2>Город</h2>
      <div className="group">
        <label className="row">
          <span>📍</span>
          <select aria-label="Город" value={city.city_id} onChange={(e) => city.set(e.target.value)}>
            {city.cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </div>

      {name ? <Settings host={host} /> : (
        <div className="state">
          <p>Войдите, чтобы видеть свои события, выбрать темы и получать уведомления в Telegram.</p>
          {onLogin ? <button className="chip" onClick={onLogin}>Войти через Telegram</button> : <p>Откройте приложение в Telegram.</p>}
        </div>
      )}
      {children}
    </>
  );
}

/** Темы и уведомления вошедшего: каждое нажатие сохраняется сразу. */
function Settings({ host }: { host: boolean }) {
  const all = useTopics();
  const subscription = useTopicSubscription();
  const notifications = useNotifications();
  const picked = subscription.topics ?? [];
  const toggleTopic = (t: string) => void subscription.save(picked.includes(t) ? picked.filter((x) => x !== t) : [...picked, t]).catch(() => {});
  return (
    <>
      <h2>Мои темы</h2>
      <p className="note lead">О новых событиях по этим темам бот напишет в Telegram, не чаще раза в день.</p>
      <div className="chips wrap">
        {all.map((t) => (
          <button key={t} className="chip" aria-pressed={picked.includes(t)} disabled={subscription.saving} onClick={() => toggleTopic(t)}>
            <img src={topicIcon(t)} alt="" />{t[0]!.toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {subscription.failed && <p className="note" role="alert">{subscription.failed.message}</p>}

      <h2>Уведомления</h2>
      <div className="group">
        {NOTIFICATIONS.filter((n) => host || !n.host).map((n) => (
          <label key={n.kind} className="row switch">
            <span>{n.title}</span>
            <input type="checkbox" role="switch" checked={!notifications.muted.includes(n.kind)} onChange={() => notifications.toggle(n.kind)} />
          </label>
        ))}
      </div>
      {notifications.failed && <p className="note" role="alert">{notifications.failed.message}</p>}
    </>
  );
}
