import { useEffect } from 'react';
import { TEMPLATES } from '@yaswami/core';
import type { EventData } from '../api.ts';
import { eventLink, when } from '../format.ts';
import { inTelegram, tg } from '../tg.ts';

interface Props {
  view: EventData;
  onClose: () => void;
  toast: (text: string) => void;
}

/** Шторка «поделиться»: как событие выглядит в чате, выбор чата и ссылка. */
export function ShareSheet({ view: { event }, onClose, toast }: Props) {
  const template = TEMPLATES[event.kind];
  const date = when(event.start_at, event.timezone);
  const link = eventLink(event.id);
  const text = `${template.emoji} ${event.name}\n${date}`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      toast('Ссылка скопирована');
      onClose();
    } catch {
      toast('Не получилось скопировать');
    }
  }

  function pickChat() {
    // ponytail: пока в чат уходит ссылка на событие. Сообщение с кнопками ответа прямо в чате —
    // когда у бота появится шаринг (savePreparedInlineMessage + shareMessage).
    if (inTelegram) {
      tg!.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
      onClose();
    } else if (navigator.share) {
      void navigator.share({ text, url: link }).then(onClose, () => {});
    } else {
      void copy();
    }
  }

  return (
    <div className="sheet" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="share-title">
        <h3 id="share-title">Позовите гостей</h3>
        <p>Отправьте ссылку в чат: гости откроют событие и ответят в одно касание.</p>
        <div className="bubble">
          <div className="hero"><div className="emo">{template.emoji}</div><small>{template.label}</small><h1>{event.name}</h1></div>
          <div className="body">
            🗓 {date}
            {event.geo_address_json && <><br />📍 {event.geo_address_json.address}</>}
            {event.description && <div className="d">{event.description}</div>}
            <div className="link">{link.replace(/^https?:\/\//, '')}</div>
          </div>
        </div>
        <button className="cta" onClick={pickChat}>Выбрать чат</button>
        <button className="cta alt" onClick={() => void copy()}>Скопировать ссылку</button>
      </div>
    </div>
  );
}
