import type { Me } from '@yaswami/core';
import { inTelegram } from '../tg.ts';

interface Props {
  current: 'feed' | 'hosts' | 'mine';
  me: Me | null;
  /** На сайте можно войти через Telegram. */
  canLogin: boolean;
  onFeed: () => void;
  onHosts: () => void;
  onMine: () => void;
  onLogin: () => void;
  onLogout: () => void;
}

/** Переключатель «Все события / Организаторы / Мои» и вход на сайте. В Telegram вход не нужен: человек уже опознан. */
export function Tabs({ current, me, canLogin, onFeed, onHosts, onMine, onLogin, onLogout }: Props) {
  return (
    <div className="tabs">
      <button className="chip" aria-pressed={current === 'feed'} onClick={onFeed}>Все события</button>
      <button className="chip" aria-pressed={current === 'hosts'} onClick={onHosts}>Организаторы</button>
      {(me || canLogin) && <button className="chip" aria-pressed={current === 'mine'} onClick={onMine}>Мои</button>}
      {!inTelegram && (me
        ? <button className="chip end" onClick={onLogout}>Выйти</button>
        : canLogin && <button className="chip end" onClick={onLogin}>Войти</button>)}
    </div>
  );
}
