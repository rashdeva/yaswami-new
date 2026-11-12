import { useEffect, useRef } from 'react';
import { haptic, nativeBack, tg } from '../tg.ts';

/** Кнопка «назад» в шапке Telegram: видна, пока есть куда возвращаться. `back` = null — мы в корне. */
export function useTelegramBack(back: (() => void) | null) {
  const backRef = useRef(back);
  backRef.current = back;
  const canGoBack = back !== null;

  useEffect(() => {
    if (!nativeBack || !tg) return;
    const onBack = () => {
      haptic.tap();
      backRef.current?.();
    };
    const button = tg.BackButton;
    button.onClick(onBack);
    return () => button.offClick(onBack);
  }, []);
  useEffect(() => {
    if (nativeBack) canGoBack ? tg?.BackButton.show() : tg?.BackButton.hide();
  }, [canGoBack]);
}
