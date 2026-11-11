import { api } from '../api.ts';
import { useAct } from './useAct.ts';

/** Наши аккаунты Telegram: сам список приходит с лентой (`useFeed().accounts`), здесь — действия. */
export function useAccounts() {
  return {
    create: useAct(api.accountCreate),
    /** Шаг входа: код из Telegram или пароль двухэтапной проверки. */
    login: useAct(({ id, secret }: { id: string; secret: string }) => api.accountLogin(id, secret)),
    remove: useAct(api.accountDelete),
  };
}
