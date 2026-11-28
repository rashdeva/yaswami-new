// Мой профиль: таким его видят другие — у организатора его страница (HostProfile), у остальных аватар и имя.
// Справа сверху — «поделиться» (у организатора) и шестерёнка: город, темы, уведомления и выход — в настройках.
// Ниже, `children`, — мои события у вошедшего.
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import type { CollectedEventItem, ProductItem } from '@yaswami/core';
import { Avatar } from '../components/Avatar.tsx';
import { HeroButton } from '../components/HeroButton.tsx';
import { hostLink } from '../format.ts';
import { useHost } from '../hooks/useHosts.ts';
import { useViewed } from '../hooks/useViewed.ts';
import { shareLink } from '../share.ts';
import { HostProfile } from './HostProfile.tsx';

interface Props {
  /** Имя вошедшего; null — гость без входа. */
  name: string | null;
  /** Профиль организатора вошедшего; null — его нет. */
  hostId: string | null;
  city: string;
  /** Гостю: войти. null — войти здесь нельзя (вне Telegram без настроенного входа). */
  onLogin: (() => void) | null;
  /** Кнопка «назад» на странице; null — её рисует Telegram. */
  onBack: (() => void) | null;
  onSettings: () => void;
  onOpenEvent: (event: CollectedEventItem) => void;
  onOpenProduct: (product: ProductItem) => void;
  toast: (text: string) => void;
  /** Мои события — у вошедшего. */
  children?: ReactNode;
}

export function ProfileScreen({ name, hostId, city, onLogin, onBack, onSettings, onOpenEvent, onOpenProduct, toast, children }: Props) {
  useViewed('profile_opened');
  useEffect(() => { document.title = 'Профиль — Я с вами'; }, []);
  const back = onBack && <button className="back" onClick={onBack}>← Все события</button>;
  const settings = <HeroButton icon="settings" label="Настройки" onClick={onSettings} />;
  return (
    <>
      {hostId ? (
        <OwnHost id={hostId} city={city} back={back} settings={settings} onOpenEvent={onOpenEvent} onOpenProduct={onOpenProduct} toast={toast}
          fallback={<Plain name={name} city={city} back={back} settings={settings} />} />
      ) : <Plain name={name} city={city} back={back} settings={settings} />}

      {!name && (
        <div className="state">
          <p>Войдите, чтобы видеть свои события, выбрать темы и получать уведомления в Telegram.</p>
          {onLogin ? <button className="chip" onClick={onLogin}>Войти через Telegram</button> : <p>Откройте приложение в Telegram.</p>}
        </div>
      )}
      {children}
    </>
  );
}

/** Шапка того, у кого нет страницы организатора: аватарка из Telegram, имя и город. */
function Plain({ name, city, back, settings }: { name: string | null; city: string; back: ReactNode; settings: ReactNode }) {
  return (
    <div className={`hero${back ? '' : ' nb'}`}>
      {back}
      <div className="tools">{settings}</div>
      <Avatar big />
      <small>{city}</small>
      <h1>{name ?? 'Гость'}</h1>
    </div>
  );
}

interface OwnHostProps {
  id: string;
  city: string;
  back: ReactNode;
  settings: ReactNode;
  fallback: ReactNode;
  onOpenEvent: (event: CollectedEventItem) => void;
  onOpenProduct: (product: ProductItem) => void;
  toast: (text: string) => void;
}

/** Страница организатора — как её видят другие, с «Поделиться профилем»; её события — в «Моих событиях» ниже. */
function OwnHost({ id, city, back, settings, fallback, onOpenEvent, onOpenProduct, toast }: OwnHostProps) {
  const { host, loaded, failed } = useHost(id);
  // Страницы нет (профиль отклонён командой) — профиль как у всех.
  if (failed) return fallback;
  if (!host) return <div className="state"><div className="spinner" role="status" aria-label="Загрузка" /></div>;
  const share = () => shareLink(hostLink(id), `${host.name} — ${city}`, toast);
  return (
    <HostProfile host={host} loaded={loaded} city={city} own events={false} onOpenEvent={onOpenEvent} onOpenProduct={onOpenProduct}
      back={back}
      tools={<><HeroButton icon="share" label="Поделиться профилем" onClick={share} />{settings}</>}
      lead={<div className="profile-share"><button className="cta alt" onClick={share}>Поделиться профилем</button></div>} />
  );
}
