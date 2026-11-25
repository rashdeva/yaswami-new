import { haptic } from '../tg.ts';

export type Tab = 'feed' | 'hosts' | 'products';

const ICONS: Record<Tab, React.ReactNode> = {
  feed: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
      <circle cx="8.5" cy="14.5" r="1.2" className="dot" />
    </>
  ),
  hosts: (
    <>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5" />
      <circle cx="17" cy="9.5" r="2.7" />
      <path d="M16.5 14.6c2.6.1 4.5 1.8 5 4.9" />
    </>
  ),
  products: (
    <>
      <path d="M5 8.5h14l-1.2 10.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8z" />
      <path d="M9 11V7a3 3 0 0 1 6 0v4" />
    </>
  ),
};
const LABELS: Record<Tab, string> = { feed: 'События', hosts: 'Услуги', products: 'Товары' };

/**
 * Нижний таббар, как в iOS. `tabs` — вкладка и куда она ведёт.
 * Подложка активной вкладки переезжает пружиной; смена вкладки — лёгкий хаптик, нажатие на открытую — наверх страницы.
 * Поиска здесь нет: он — строкой в шапке «Событий» и «Услуг».
 */
export function TabBar({ current, tabs }: { current: Tab | null; tabs: [Tab, () => void][] }) {
  const index = tabs.findIndex(([t]) => t === current);
  const open = (tab: Tab, go: () => void) => {
    if (tab === current) {
      haptic.tap();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    haptic.select();
    go();
  };
  return (
    <nav className="tabbar" aria-label="Разделы">
      <div style={{ '--n': tabs.length, '--i': index } as React.CSSProperties}>
        {index >= 0 && <span className="pill" aria-hidden="true" />}
        {tabs.map(([tab, go]) => (
          <button key={tab} aria-current={tab === current ? 'page' : undefined} onClick={() => open(tab, go)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">{ICONS[tab]}</svg>
            {LABELS[tab]}
          </button>
        ))}
      </div>
    </nav>
  );
}
