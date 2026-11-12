import { useEffect } from 'react';
import { track } from '../analytics.ts';

/** Экран показан: одно действие аналитики на открытие (и на смену `id`, если экран про сущность). */
export function useViewed(action: Parameters<typeof track>[0], id?: string) {
  useEffect(() => { track(action, id ? { id } : undefined); }, [action, id]);
}
