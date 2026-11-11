// Корневой layout приложения: цвет шаблона, тост, кнопка «назад» и то, что нужно нескольким страницам сразу.
import { Outlet, useLocation, useMatchRoute, useNavigate } from '@tanstack/react-router';
import { createContext, useContext, useState } from 'react';
import type { CollectedEventItem, Event } from '@yaswami/core';
import { loginUrl } from './api.ts';
import { tint } from './format.ts';
import { useMyEvents } from './hooks/useMyEvents.ts';
import { useSession } from './hooks/useSession.ts';
import { useTelegramBack } from './hooks/useTelegramBack.ts';
import { useToast } from './hooks/useToast.ts';
import { ClaimBanner } from './screens/ClaimBanner.tsx';
import { Tabs } from './screens/Tabs.tsx';
import { haptic, nativeBack } from './tg.ts';

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
  if ((pathname === '/' || pathname.startsWith('/e/')) && kind !== 'o') setKind('o');

  // Куда ведёт «назад»: событие → свой список, создание → список или витрина. null — корень.
  const here = { includeSearch: false } as const; // ?signup, ?startapp в адресе маршрут не меняют
  const section = matchRoute({ to: '/events/$id/edit/$section', ...here });
  const edit = matchRoute({ to: '/events/$id/edit', ...here });
  const back = matchRoute({ to: '/e/$id', ...here })
    ? () => void navigate({ to: '/' })
    : section
      ? () => void navigate({ to: '/events/$id/edit', params: { id: section.id } })
      : edit
        ? () => void navigate({ to: '/events/$id', params: { id: edit.id } })
        : matchRoute({ to: '/events/$id', ...here })
          ? () => void navigate({ to: '/my' })
          : matchRoute({ to: '/new', ...here })
            ? () => void navigate({ to: hasEvents ? '/my' : '/' })
            : null;
  useTelegramBack(back);

  return (
    <ShellContext value={{ toast: showToast, onKind: setKind, onBack: nativeBack ? null : back }}>
      <div style={tint(kind)}>
        <div className="air" />
        <Outlet />
        {toast && <div className="toast" role="status">{toast}</div>}
      </div>
    </ShellContext>
  );
}

/** Переключатель «Все события / Мои» со входом и выходом; страница ставит его в свою шапку. */
export function AppTabs({ current }: { current: 'feed' | 'mine' }) {
  const navigate = useNavigate();
  const { me, authed, canLogin, logout } = useSession();
  const { hasEvents } = useMyEvents();
  const { toast } = useShell();
  return (
    <Tabs
      current={current}
      me={me ?? null}
      canLogin={canLogin}
      onFeed={() => void navigate({ to: '/' })}
      onMine={() => (authed ? void navigate({ to: hasEvents ? '/my' : '/new' }) : void (location.href = loginUrl('/my')))}
      onLogin={() => void (location.href = loginUrl(location.pathname))}
      onLogout={() => void logout().catch((e: Error) => toast(e.message))}
    />
  );
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
