import { useEffect, useState } from 'react';

/**
 * Ролик-обложка в шапке: играет сам без звука; пауза и звук — по кнопкам. Отдаёт ref-колбэк для <video> и состояние.
 * Пауза берётся из событий самого ролика: браузер может и не дать автозапуск (экономия трафика), тогда кнопка покажет ▶.
 */
export function useHeroVideo() {
  const [video, ref] = useState<HTMLVideoElement | null>(null);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  useEffect(() => {
    if (!video) return;
    const sync = () => setPaused(video.paused);
    sync();
    video.addEventListener('play', sync);
    video.addEventListener('pause', sync);
    return () => { video.removeEventListener('play', sync); video.removeEventListener('pause', sync); };
  }, [video]);
  return {
    ref, paused, muted,
    togglePlay: () => { if (video?.paused) void video.play().catch(() => {}); else video?.pause(); },
    toggleSound: () => { if (video) setMuted((video.muted = !video.muted)); },
  };
}
