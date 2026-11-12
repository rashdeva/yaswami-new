// Корневой layout: вход, боковое меню разделов, шапка с «ждут вас» и состоянием связи.
import { Link, Outlet, useMatchRoute } from '@tanstack/react-router';
import {
  ActivityIcon, BotIcon, CalendarCheckIcon, ChevronsUpDownIcon, HistoryIcon, LayoutListIcon, LogOutIcon, MegaphoneIcon, MessagesSquareIcon, RadioTowerIcon,
  SmartphoneIcon, UserIcon,
} from 'lucide-react';
import { loginUrl } from '@/api';
import { Hint } from '@/components/Page';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Item, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuBadge,
  SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar,
} from '@/components/ui/sidebar';
import { useCollectedEvents } from '@/hooks/useCollectedEvents';
import { useInbox } from '@/hooks/useInbox';
import { useLogout } from '@/hooks/useLogout';
import { useUser } from '@/hooks/useUsers';
import { initials } from '@/lib/inbox';

const NAV = [
  { group: null, items: [
    { to: '/', label: 'Люди', icon: MessagesSquareIcon },
    { to: '/feed', label: 'Лента', icon: ActivityIcon },
    { to: '/agents', label: 'Агенты', icon: BotIcon },
  ] },
  { group: 'Сбор анонсов', items: [
    { to: '/catalog', label: 'Каталог', icon: LayoutListIcon },
    { to: '/hosts', label: 'Организаторы', icon: MegaphoneIcon },
    { to: '/sources', label: 'Источники', icon: RadioTowerIcon },
  ] },
  { group: 'Сервис', items: [
    { to: '/events', label: 'События Ясвами', icon: CalendarCheckIcon },
    { to: '/users', label: 'Пользователи', icon: UserIcon },
  ] },
  { group: 'Команда', items: [
    { to: '/accounts', label: 'Аккаунты', icon: SmartphoneIcon },
    { to: '/actions', label: 'Журнал', icon: HistoryIcon },
  ] },
] as const;
/** Подсказка клавиш переписки (hooks/useInboxKeys.ts). */
const KEYS = [['↑ ↓', 'выбрать'], ['Enter', 'ответ / черновик'], ['E', 'править'], ['X', 'отклонить'], ['T', 'взять'], ['D', 'готово'], ['/', 'поиск']] as const;
type To = (typeof NAV)[number]['items'][number]['to'];

/** Кто вошёл: аватар с инициалами, имя; по клику — своя карточка и выход. */
function Me({ id }: { id: number }) {
  const { data } = useUser(id);
  const logout = useLogout();
  const name = data?.user.first_name ?? '…';
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg">
              <Avatar><AvatarFallback>{initials(name)}</AvatarFallback></Avatar>
              <Item size="xs" className="min-w-0 flex-1 flex-nowrap border-0 p-0">
                <ItemContent className="min-w-0">
                  <ItemTitle>{name}</ItemTitle>
                  <ItemDescription className="truncate">{data?.user.username ? `@${data.user.username}` : 'Команда'}</ItemDescription>
                </ItemContent>
              </Item>
              <ChevronsUpDownIcon className="ml-auto text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-(--radix-dropdown-menu-trigger-width)">
            <DropdownMenuItem asChild><Link to="/users/$id" params={{ id: String(id) }}><UserIcon />Моя карточка</Link></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => logout()}><LogOutIcon />Выйти</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/** Кнопка меню в шапке — только когда меню закрыто или экран узкий: иначе она в самом меню. */
function OpenMenu() {
  const { open, isMobile } = useSidebar();
  return open && !isMobile ? null : <SidebarTrigger />;
}

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
  const { data: collected } = useCollectedEvents(); // загружается сразу: нужен счётчик в меню
  const match = useMatchRoute();
  if (!feed) return <Gate problem={problem} />;

  const counts: Partial<Record<To, number>> = {
    '/catalog': collected?.filter((e) => e.status === 'pending').length, // ждут решения
    '/accounts': feed.accounts.filter((a) => a.status === 'active').length, // на связи
  };
  const inFeed = !!match({ to: '/feed' });

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="flex-row items-center gap-2 px-4 pt-4 pb-2">
          <img src={`${import.meta.env.BASE_URL}mark.svg`} alt="" className="size-7" />
          <span className="font-semibold tracking-tight">Я с вами</span>
          <SidebarTrigger className="ml-auto" />
        </SidebarHeader>
        <SidebarContent>
          {NAV.map(({ group, items }) => (
            <SidebarGroup key={group ?? ''}>
              {group && <SidebarGroupLabel>{group}</SidebarGroupLabel>}
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map(({ to, label, icon: Icon }) => (
                    <SidebarMenuItem key={to}>
                      <SidebarMenuButton asChild isActive={!!match({ to, fuzzy: to !== '/' })}>
                        <Link to={to}><Icon />{label}</Link>
                      </SidebarMenuButton>
                      {!!counts[to] && <SidebarMenuBadge>{counts[to]}</SidebarMenuBadge>}
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter className="p-3"><Me id={feed.me} /></SidebarFooter>
      </Sidebar>
      <SidebarInset className="h-svh min-w-0">
        <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
          <OpenMenu />
          <Badge variant="secondary">Ждут вас: {feed.conversations.filter((c) => c.attention).length}</Badge>
          {problem && <Badge variant="destructive">Нет связи с сервером</Badge>}
          {(inFeed || !!match({ to: '/' })) && (
            <div className="ml-auto hidden xl:block"><Hint><span className="flex items-center gap-3">
              {[...KEYS, ...(inFeed ? [['O', 'переписка'] as const] : [])].map(([keys, label]) => (
                <span key={label} className="flex items-center gap-1"><KbdGroup>{keys.split(' ').map((k) => <Kbd key={k}>{k}</Kbd>)}</KbdGroup>{label}</span>
              ))}
            </span></Hint></div>
          )}
        </header>
        <div className="min-h-0 flex-1"><Outlet /></div>
      </SidebarInset>
    </SidebarProvider>
  );
}
