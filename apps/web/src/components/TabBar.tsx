/** Нижний таббар, как в iOS: две витрины — события и организаторы. `current` — null, если открыт другой раздел («Мои»). */
export function TabBar({ current, onFeed, onHosts }: { current: 'feed' | 'hosts' | null; onFeed: () => void; onHosts: () => void }) {
  return (
    <nav className="tabbar" aria-label="Разделы">
      <div>
        <button aria-current={current === 'feed' ? 'page' : undefined} onClick={onFeed}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3.5" y="5" width="17" height="15.5" rx="3.5" />
            <path d="M3.5 10h17M8 3v4M16 3v4" />
            <circle cx="8.5" cy="14.5" r="1.2" className="dot" />
          </svg>
          События
        </button>
        <button aria-current={current === 'hosts' ? 'page' : undefined} onClick={onHosts}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="9" cy="8.5" r="3.5" />
            <path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5" />
            <circle cx="17" cy="9.5" r="2.7" />
            <path d="M16.5 14.6c2.6.1 4.5 1.8 5 4.9" />
          </svg>
          Организаторы
        </button>
      </div>
    </nav>
  );
}
