import { useEffect } from 'react';
import type { CollectedEventItem, ProductItem } from '@yaswami/core';
import { track } from '../analytics.ts';
import { HeroButton } from '../components/HeroButton.tsx';
import { hostLink } from '../format.ts';
import { useHost } from '../hooks/useHosts.ts';
import { useViewed } from '../hooks/useViewed.ts';
import { shareLink } from '../share.ts';
import { openExternal } from '../tg.ts';
import { HostProfile } from './HostProfile.tsx';

interface Props {
  id: string;
  city: string;
  onOpenEvent: (event: CollectedEventItem) => void;
  onOpenProduct: (product: ProductItem) => void;
  onBack: (() => void) | null;
  /** Человек смотрит собственную страницу: вместо «Оставить отзыв» — ссылка для клиентов и бонус за отзыв. */
  own: boolean;
  toast: (text: string) => void;
}

/** Страница организатора или мастера: кто это, что ведёт, что продаёт, ближайшие события и как ему написать. */
export function HostScreen({ id, city, onOpenEvent, onOpenProduct, onBack, own, toast }: Props) {
  const { host, loaded, failed } = useHost(id);
  useViewed('host_viewed', id);
  useEffect(() => { if (host) document.title = `${host.name} — ${city}, Я с вами`; }, [host, city]);

  if (!host) {
    return failed ? (
      <div className="state">
        <b>🫥</b>
        <p>{failed.message}</p>
        {onBack && <button className="chip" onClick={onBack}>← Назад</button>}
      </div>
    ) : (
      <div className="state"><div className="spinner" role="status" aria-label="Загрузка" /></div>
    );
  }

  return (
    <>
      <HostProfile host={host} loaded={loaded} city={city} own={own} events onOpenEvent={onOpenEvent} onOpenProduct={onOpenProduct}
        back={onBack && <button className="back" onClick={onBack}>← Назад</button>}
        tools={<HeroButton icon="share" label="Поделиться" onClick={() => shareLink(hostLink(id), `${host.name} — ${city}`, toast)} />} />

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
