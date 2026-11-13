import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CollectedMedia } from '@yaswami/core';

interface Props {
  items: CollectedMedia[];
  start: number;
  onClose: () => void;
}

/** Фото и видео на весь экран, листаются свайпом, как в Telegram. Перелистнули — ролик на прошлом слайде встаёт на паузу. */
export function MediaViewer({ items, start, onClose }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(start);

  useLayoutEffect(() => {
    const el = track.current!;
    el.scrollLeft = start * el.clientWidth;
  }, [start]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  function onScroll() {
    const el = track.current!;
    const next = Math.round(el.scrollLeft / el.clientWidth);
    if (next === index) return;
    el.querySelectorAll('video').forEach((v) => v.pause());
    setIndex(next);
  }

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label="Фото и видео">
      <div className="viewer-bar">
        <span>{items.length > 1 ? `${index + 1} из ${items.length}` : ''}</span>
        <button onClick={onClose} aria-label="Закрыть">✕</button>
      </div>
      <div className="viewer-track" ref={track} onScroll={onScroll}>
        {items.map((m, i) => (
          <div key={m.url} className="viewer-slide" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            {m.type === 'video'
              ? <video src={m.url} controls playsInline autoPlay={i === start} preload="metadata" />
              : <img src={m.url} alt="" />}
          </div>
        ))}
      </div>
    </div>
  );
}
