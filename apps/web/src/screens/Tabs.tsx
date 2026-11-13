import type { Me } from '@yaswami/core';
import { inTelegram } from '../tg.ts';

interface Props {
  me: Me | null;
  /** На сайте можно войти через Telegram. */
  canLogin: boolean;
  onLogin: () => void;
  onLogout: () => void;
}

/** Вход и выход на сайте над экраном; разделы переключает нижний таббар (TabBar). В Telegram вход не нужен: человек уже опознан. */
export function Tabs({ me, canLogin, onLogin, onLogout }: Props) {
  return (
    <div className="tabs">
      {!inTelegram && (me
        ? <button className="chip end" onClick={onLogout}>Выйти</button>
        : canLogin && <button className="chip end" onClick={onLogin}>Войти</button>)}
    </div>
  );
}
