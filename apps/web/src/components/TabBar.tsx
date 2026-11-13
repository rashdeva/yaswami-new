import { haptic } from '../tg.ts';

export type Tab = 'feed' | 'hosts' | 'mine';

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
  mine: (
    <>
      <path d="M12 20.5s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.9c0 5.6-7.5 10-7.5 10Z" />
    </>
  ),
};
const LABELS: Record<Tab, string> = { feed: 'События', hosts: 'Организаторы', mine: 'Мои' };

/**
 * Нижний таббар, как в iOS. `tabs` — вкладка и куда она ведёт; «Мои» передают, только когда человек вошёл или может войти.
 * Подложка активной вкладки переезжает пружиной; смена вкладки — лёгкий хаптик, нажатие на открытую — наверх страницы.
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
