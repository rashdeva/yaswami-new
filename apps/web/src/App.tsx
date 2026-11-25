// Корневой layout приложения: цвет шаблона, тост, кнопка «назад» и то, что нужно нескольким страницам сразу.
import { Outlet, useLocation, useMatchRoute, useNavigate } from '@tanstack/react-router';
import { createContext, useContext, useEffect, useState } from 'react';
import type { CollectedEventItem, Event } from '@yaswami/core';
import { tint } from './format.ts';
import { useFeature } from './hooks/useFeature.ts';
import { useMyEvents } from './hooks/useMyEvents.ts';
import { useProductsTab } from './hooks/useProducts.ts';
import { useSession } from './hooks/useSession.ts';
import { useTelegramBack } from './hooks/useTelegramBack.ts';
import { useToast } from './hooks/useToast.ts';
import { ClaimBanner } from './screens/ClaimBanner.tsx';
import type { Tab } from './components/TabBar.tsx';
import { TabBar } from './components/TabBar.tsx';
import { haptic, inTelegram, nativeBack } from './tg.ts';

interface Shell {
  toast: (text: string) => void;
  /** Личные экраны выставляют цвет шаблона своего события. */
  onKind: (kind: Event['kind']) => void;
  /** Кнопка «назад» на странице; null — её рисует Telegram или возвращаться некуда. */
  onBack: (() => void) | null;
}
const ShellContext = createContext<Shell | null>(null);
export const useShell = () => useContext(ShellContext)!;

export function App() {
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();
  const { pathname } = useLocation();
  const { hasEvents } = useMyEvents();
  const { toast, showToast } = useToast();
  const [kind, setKind] = useState<Event['kind']>('o');

  // У публичных экранов свой нейтральный цвет; личные выставляют цвет шаблона события сами.
  if ((pathname === '/' || pathname.startsWith('/e/') || pathname.startsWith('/s/') || pathname.startsWith('/d/') || pathname === '/all' || pathname.startsWith('/hosts') || pathname.startsWith('/products') || pathname === '/services' || pathname === '/search') && kind !== 'o') setKind('o');

  // Куда ведёт «назад»: событие, полка, направление, все события, поиск и профиль → витрина, организатор → каталог, товар → товары, своё событие и поиск людей → профиль,
  // создание → профиль или витрина. null — корень (вкладки таббара).
  const here = { includeSearch: false } as const; // ?signup, ?startapp в адресе маршрут не меняют
  const section = matchRoute({ to: '/events/$id/edit/$section', ...here });
  const edit = matchRoute({ to: '/events/$id/edit', ...here });
  const back = matchRoute({ to: '/e/$id', ...here }) || matchRoute({ to: '/s/$id', ...here }) || matchRoute({ to: '/d/$slug', ...here }) || matchRoute({ to: '/all', ...here }) || matchRoute({ to: '/search', ...here }) || matchRoute({ to: '/my', ...here })
    ? () => void navigate({ to: '/' })
    : matchRoute({ to: '/hosts/$id', ...here })
      ? () => void navigate({ to: '/services' })
    : matchRoute({ to: '/products/$id', ...here })
      ? () => void navigate({ to: '/products' })
    : section
      ? () => void navigate({ to: '/events/$id/edit', params: { id: section.id } })
      : edit
        ? () => void navigate({ to: '/events/$id', params: { id: edit.id } })
        : matchRoute({ to: '/events/$id', ...here }) || matchRoute({ to: '/people', ...here })
          ? () => void navigate({ to: '/my' })
          : matchRoute({ to: '/new', ...here })
            ? () => void navigate({ to: hasEvents ? '/my' : '/' })
            : null;
  useTelegramBack(back);
  // Витрина и её экраны на широком окне — шире обычной колонки, полки сеткой (app.css, #app[data-wide]).
  const wide = pathname === '/' || pathname === '/all' || pathname.startsWith('/d/') || pathname.startsWith('/s/');
  useEffect(() => {
    const root = document.getElementById('app');
    if (root) root.toggleAttribute('data-wide', wide);
  }, [wide]);
  const withTabBar = pathname === '/' || pathname === '/services' || pathname === '/products' || pathname === '/search';

  return (
    <ShellContext value={{ toast: showToast, onKind: setKind, onBack: nativeBack ? null : back }}>
      <div style={tint(kind)} className={withTabBar ? 'with-tabbar' : undefined}>
        <div className="air" />
        <Outlet />
        {/* Таббар — на корневых разделах; у страниц события и организатора внизу своя кнопка действия и «назад». */}
        {withTabBar && <AppTabBar current={pathname === '/' ? 'feed' : pathname === '/services' ? 'hosts' : pathname === '/products' ? 'products' : null} />}
        {toast && <div className="toast" role="status">{toast}</div>}
      </div>
    </ShellContext>
  );
}

/**
 * Нижний таббар разделов: события, услуги и товары. Мои события — в профиле, за аватаркой в шапке.
 * «Товары» — когда в городе набралось мастеров с товарами (useProductsTab); открытый по прямой ссылке раздел вкладку показывает всегда.
 */
function AppTabBar({ current }: { current: Tab | null }) {
  const navigate = useNavigate();
  const products = useProductsTab() || current === 'products';
  const tabs: [Tab, () => void][] = [
    ['feed', () => void navigate({ to: '/' })],
    ['hosts', () => void navigate({ to: '/services' })],
    ...(products ? [['products', () => void navigate({ to: '/products' })] satisfies [Tab, () => void]] : []),
  ];
  return <TabBar current={current} tabs={tabs} searching={current === null} onSearch={() => void navigate({ to: '/search' })} />;
}

/** Выйти на сайте; null — в Telegram, там человек опознан самим Telegram. */
export function useLogout(): (() => void) | null {
  const { logout } = useSession();
  const { toast } = useShell();
  return inTelegram ? null : () => void logout().catch((e: Error) => toast(e.message));
}

/** «Это моё событие»: подтвердить собранное событие; удалось — открывается событие Ясвами. */
export function useClaim() {
  const { claim } = useSession();
  const { toast } = useShell();
  return async (item: CollectedEventItem) => {
    try {
      await claim(item.id);
      haptic.success();
    } catch (e) {
      haptic.error();
      toast((e as Error).message);
    }
  };
}

/** Блок над списком: предложение организатору подтвердить свои события. */
export function Claims() {
  const { me } = useSession();
  return <ClaimBanner items={me?.claimable ?? []} onClaim={useClaim()} />;
}
