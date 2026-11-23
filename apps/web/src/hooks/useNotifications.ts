import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Me, Notification } from '@yaswami/core';
import { track } from '../analytics.ts';
import { api } from '../api.ts';
import { keys } from './keys.ts';
import { useSession } from './useSession.ts';

/** Уведомления бота в профиле: какие выключены и переключатель. Выключенное бот не шлёт (`muted_notifications`). */
export function useNotifications() {
  const client = useQueryClient();
  const { me } = useSession();
  const muted = me?.muted_notifications ?? [];
  const save = useMutation({
    mutationFn: (next: Notification[]) => api.updateSelf({ muted_notifications: next }),
    // Переключатель отзывается сразу; не сохранилось — возвращаем то, что на сервере.
    onMutate: (next) => client.setQueryData<Me | null>(keys.me, (m) => m && { ...m, muted_notifications: next }),
    onSuccess: (next) => client.setQueryData(keys.me, next),
    onError: () => void client.invalidateQueries({ queryKey: keys.me }),
  });
  const toggle = (kind: Notification) => {
    const on = muted.includes(kind);
    track('notification_toggled', { kind, on });
    save.mutate(on ? muted.filter((k) => k !== kind) : [...muted, kind]);
  };
  return { muted, toggle, failed: save.error };
}
