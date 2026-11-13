import type { Me } from '@yaswami/core';
import { inTelegram } from '../tg.ts';

interface Props {
  current: 'feed' | 'hosts' | 'mine';
  me: Me | null;
  /** На сайте можно войти через Telegram. */
  canLogin: boolean;
  onMine: () => void;
  onLogin: () => void;
  onLogout: () => void;
}

/** «Мои» и вход на сайте над экраном; между событиями и организаторами переключает нижний таббар (TabBar). В Telegram вход не нужен: человек уже опознан. */
export function Tabs({ current, me, canLogin, onMine, onLogin, onLogout }: Props) {
  return (
    <div className="tabs">
      {(me || canLogin) && <button className="chip" aria-pressed={current === 'mine'} onClick={onMine}>Мои</button>}
      {!inTelegram && (me
        ? <button className="chip end" onClick={onLogout}>Выйти</button>
        : canLogin && <button className="chip end" onClick={onLogin}>Войти</button>)}
    </div>
  );
}
