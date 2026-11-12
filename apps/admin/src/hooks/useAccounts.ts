import { api } from '../api.ts';
import { useAct } from './useAct.ts';

/** Наши аккаунты Telegram: сам список приходит с лентой (`useFeed().accounts`), здесь — действия. */
export function useAccounts() {
  return {
    create: useAct(api.accountCreate, { undo: (_, a) => ['account', a.id] }),
    rename: useAct(({ id, label }: { id: string; label: string }) => api.accountUpdate(id, { label }), { undo: ({ id }) => ['account', id] }),
    /** Шаг входа: код из Telegram или пароль двухэтапной проверки. Секрет — не в журнал, шаг не отменяется. */
    login: useAct(({ id, secret }: { id: string; secret: string }) => api.accountLogin(id, secret)),
    /** Сессия удаляется вместе с аккаунтом: не отменяется. */
    remove: useAct(api.accountDelete),
  };
}
