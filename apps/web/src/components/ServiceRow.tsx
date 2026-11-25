import type { HostListItem, Practice } from '@yaswami/core';
import { hue } from '../format.ts';

/**
 * Строка услуги в списке: мастер кружком, название, под ним мастер и цена. Кнопки записи нет —
 * нажатие открывает шторку услуги (PracticeSheet), запись там.
 */
export function ServiceRow({ practice, host, onOpen }: { practice: Practice; host: Pick<HostListItem, 'name' | 'photo_url'>; onOpen: () => void }) {
  return (
    <button className="service" onClick={onOpen}>
      <span className="ava" style={{ background: `hsl(${hue(host.name)},55%,42%)` }}>
        {[...host.name][0]}
        {/* Фото поверх буквы: не загрузилось — остаётся кружок с буквой. */}
        {host.photo_url && <img src={host.photo_url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.hidden = true; }} />}
      </span>
      <span className="service-text">
        <b>{practice.title}</b>
        <small>{host.name} · {practice.price ?? 'цена по запросу'}</small>
      </span>
      <span className="service-chev" aria-hidden="true">›</span>
    </button>
  );
}
