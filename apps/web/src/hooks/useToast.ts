import { useCallback, useRef, useState } from 'react';

/** Короткое сообщение внизу экрана: гаснет само, новое заменяет прежнее. */
export function useToast() {
  const [toast, setToast] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const showToast = useCallback((text: string) => {
    setToast(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(''), 2400);
  }, []);
  return { toast, showToast };
}
