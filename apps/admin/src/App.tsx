// Корневой layout: вход, боковое меню разделов, шапка с «ждут вас» и состоянием связи.
import { Link, Outlet, useMatchRoute } from '@tanstack/react-router';
import { ActivityIcon, BotIcon, CalendarCheckIcon, LogOutIcon, MegaphoneIcon, SmartphoneIcon, UsersIcon } from 'lucide-react';
import { loginUrl } from '@/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuBadge, SidebarMenuButton,
  SidebarMenuItem, SidebarProvider, SidebarTrigger,
} from '@/components/ui/sidebar';
import { useCollectedEvents } from '@/hooks/useCollectedEvents';
import { useInbox } from '@/hooks/useInbox';
import { useLogout } from '@/hooks/useLogout';

const NAV = [
  { to: '/', label: 'Люди', icon: UsersIcon },
  { to: '/feed', label: 'Лента', icon: ActivityIcon },
  { to: '/hosts', label: 'Организаторы', icon: MegaphoneIcon },
  { to: '/agents', label: 'Агенты', icon: BotIcon },
  { to: '/events', label: 'События', icon: CalendarCheckIcon },
  { to: '/accounts', label: 'Аккаунты', icon: SmartphoneIcon },
] as const;

/** Пока ленты нет: вход через Telegram, «нет доступа» или ожидание связи. */
function Gate({ problem }: { problem: string | null }) {
  return (
    <div className="grid h-svh place-items-center p-6 text-sm">
      {problem === 'unauthorized' && <Button asChild><a href={loginUrl(location.pathname + location.search)}>Войти через Telegram</a></Button>}
      {problem === 'forbidden' && <p>У этого аккаунта нет доступа к админке.</p>}
      {problem && problem !== 'unauthorized' && problem !== 'forbidden' && <p>Не получилось загрузить переписку. Повторяю…</p>}
    </div>
  );
}

export function App() {
  const { feed, problem } = useInbox();
  const events = useCollectedEvents(); // загружается сразу: нужен счётчик в меню
  const logout = useLogout();
  const match = useMatchRoute();
  if (!feed) return <Gate problem={problem} />;

  const counts: Partial<Record<(typeof NAV)[number]['to'], number>> = {
    '/events': events?.filter((e) => e.status === 'pending').length, // ждут решения
    '/accounts': feed.accounts.filter((a) => a.status === 'active').length, // на связи
  };
  const inFeed = !!match({ to: '/feed' });

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="px-4 py-3 font-semibold">Я с вами</SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV.map(({ to, label, icon: Icon }) => (
                  <SidebarMenuItem key={to}>
                    <SidebarMenuButton asChild isActive={!!match({ to })}>
                      <Link to={to}><Icon />{label}</Link>
                    </SidebarMenuButton>
                    {!!counts[to] && <SidebarMenuBadge>{counts[to]}</SidebarMenuBadge>}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => logout()}><LogOutIcon />Выйти</SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="h-svh min-w-0">
        <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
          <SidebarTrigger />
          <Badge variant="secondary">Ждут вас: {feed.conversations.filter((c) => c.attention).length}</Badge>
          {problem && <Badge variant="destructive">Нет связи с сервером</Badge>}
          {(inFeed || !!match({ to: '/' })) && (
            <span className="ml-auto hidden text-xs text-muted-foreground xl:block">
              ↑↓ выбрать · Enter ответить или отправить черновик · E править · X отклонить · T взять / вернуть боту · D готово · / поиск{inFeed && ' · O переписка'}
            </span>
          )}
        </header>
        <div className="min-h-0 flex-1"><Outlet /></div>
      </SidebarInset>
    </SidebarProvider>
  );
}
