import { useEffect, useState } from 'react';

/** Элемент ушёл за верхний край экрана. Отдаёт ref-колбэк для элемента и признак «прокрутили мимо». */
export function useScrolledPast() {
  const [el, watch] = useState<Element | null>(null);
  const [past, setPast] = useState(false);
  useEffect(() => {
    if (!el) return setPast(false);
    const io = new IntersectionObserver(([e]) => setPast(!e!.isIntersecting && e!.boundingClientRect.top < 0));
    io.observe(el);
    return () => io.disconnect();
  }, [el]);
  return [watch, past] as const;
}
