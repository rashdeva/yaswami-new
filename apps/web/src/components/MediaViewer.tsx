import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CollectedMedia } from '@yaswami/core';
import { useSwipeToClose } from '../hooks/useSwipeToClose.ts';

/** Кадр просмотра. Ссылок наружу (на публикацию в канале) нет намеренно: человек остаётся у нас. */
export type ViewerItem = Pick<CollectedMedia, 'type' | 'url'>;

interface Props {
  items: ViewerItem[];
  start: number;
  onClose: () => void;
}

/**
 * Фото и видео на весь экран, как в Telegram: вбок листаются, свайп вверх или вниз закрывает. Перелистнули — ролик
 * на прошлом слайде встаёт на паузу. Рисуется порталом в body: его открывают и из шторки организатора, а у шторки
 * transform, внутри неё `position: fixed` встал бы не на весь экран.
 */
export function MediaViewer({ items, start, onClose }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(start);
  const { root, close, handlers } = useSwipeToClose(onClose);

  useLayoutEffect(() => {
    const el = track.current!;
    el.scrollLeft = start * el.clientWidth;
  }, [start]);

  const go = (step: number) => {
    const el = track.current!;
    el.scrollTo({ left: (index + step) * el.clientWidth, behavior: 'smooth' });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const el = track.current!;
        el.scrollBy({ left: (e.key === 'ArrowRight' ? 1 : -1) * el.clientWidth, behavior: 'smooth' });
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [onClose]);

  function onScroll() {
    const el = track.current!;
    const next = Math.round(el.scrollLeft / el.clientWidth);
    if (next === index) return;
    el.querySelectorAll('video').forEach((v) => v.pause());
    setIndex(next);
  }

  return createPortal(
    <div className="viewer" ref={root} role="dialog" aria-modal="true" aria-label="Фото и видео" {...handlers}>
      <div className="viewer-bar">
        <span>{items.length > 1 ? `${index + 1} из ${items.length}` : ''}</span>
        <button onClick={() => close(0)} aria-label="Закрыть">✕</button>
      </div>
      <div className="viewer-track" ref={track} onScroll={onScroll}>
        {items.map((m, i) => (
          <div key={m.url} className="viewer-slide" onClick={(e) => { if (e.target === e.currentTarget) close(0); }}>
            {m.type === 'video'
              ? <video src={m.url} controls playsInline autoPlay={i === start} preload="metadata" />
              : <img src={m.url} alt="" draggable={false} />}
          </div>
        ))}
      </div>
      {items.length > 1 && (
        <>
          <button className="viewer-nav prev" onClick={() => go(-1)} disabled={index === 0} aria-label="Предыдущее">‹</button>
          <button className="viewer-nav next" onClick={() => go(1)} disabled={index === items.length - 1} aria-label="Следующее">›</button>
        </>
      )}
    </div>,
    document.body,
  );
}
