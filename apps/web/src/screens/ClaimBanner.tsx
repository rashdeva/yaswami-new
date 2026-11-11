import { useState } from 'react';
import type { CollectedEventItem } from '@yaswami/core';
import { collectedWhen } from '@yaswami/core';
import { haptic } from '../tg.ts';

interface Props {
  items: CollectedEventItem[];
  onClaim: (item: CollectedEventItem) => Promise<void>;
}

/** Организатору: «мы нашли ваши события» — подтвердить их как свои и принимать записи в Ясвами. */
export function ClaimBanner({ items, onClaim }: Props) {
  const [pending, setPending] = useState<string | null>(null);
  if (!items.length) return null;
  return (
    <>
      <h2>{items.length === 1 ? 'Это ваше событие?' : 'Это ваши события?'}</h2>
      <p className="note lead">
        Мы нашли {items.length === 1 ? 'его' : 'их'} в открытом канале: записываться просят у вас. Подтвердите — и гости смогут
        отвечать «Пойду» прямо здесь, а вы увидите список, кто придёт, и сможете отправить приглашение в любой чат.
      </p>
      <div className="group">
        {items.map((item) => (
          <div key={item.id} className="item claim">
            <div>
              <b>{item.title}</b>
              <small>{collectedWhen(item.starts_at)}</small>
            </div>
            <button
              className="chip"
              disabled={pending !== null}
              onClick={() => {
                haptic.tap();
                setPending(item.id);
                void onClaim(item).finally(() => setPending(null));
              }}
            >
              {pending === item.id ? 'Минуту…' : 'Это моё'}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
