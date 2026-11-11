// Все маршруты админки. Страница здесь — тонкая связка: берёт адрес и раздаёт экрану props; экраны про адреса не знают.
import { createRootRoute, createRoute, createRouter, useNavigate } from '@tanstack/react-router';
import type { AgentKey } from '@yaswami/core';
import { AGENTS } from '@yaswami/core';
import { App } from '@/App';
import { AccountsScreen } from '@/screens/AccountsScreen';
import { AgentsScreen } from '@/screens/AgentsScreen';
import { EventsScreen } from '@/screens/EventsScreen';
import { FeedScreen } from '@/screens/FeedScreen';
import { HostsScreen } from '@/screens/HostsScreen';
import { PeopleScreen } from '@/screens/PeopleScreen';

const root = createRootRoute({ component: App });

/** «Люди»: выбранный диалог и фильтр по агенту живут в адресе — на них ссылаются «Организаторы» и «Агенты». */
function PeoplePage() {
  const { c, agent } = people.useSearch();
  const navigate = useNavigate();
  return (
    <PeopleScreen
      selected={c} agent={agent}
      onSelect={(id) => void navigate({ to: '/', search: { c: id, agent }, replace: true })}
      onAgent={(key) => void navigate({ to: '/', search: { c, agent: key }, replace: true })}
    />
  );
}
const people = createRoute({
  getParentRoute: () => root,
  path: '/',
  component: PeoplePage,
  validateSearch: (search: Record<string, unknown>): { c?: string; agent?: AgentKey } => ({
    c: typeof search.c === 'string' ? search.c : undefined,
    agent: typeof search.agent === 'string' && search.agent in AGENTS ? (search.agent as AgentKey) : undefined,
  }),
});

const feed = createRoute({ getParentRoute: () => root, path: '/feed', component: FeedScreen });

function HostsPage() {
  const navigate = useNavigate();
  return <HostsScreen onOpen={(c) => void navigate({ to: '/', search: { c } })} />;
}
const hosts = createRoute({ getParentRoute: () => root, path: '/hosts', component: HostsPage });

function AgentsPage() {
  const navigate = useNavigate();
  return <AgentsScreen onShow={(agent) => void navigate({ to: '/', search: { agent } })} />;
}
const agents = createRoute({ getParentRoute: () => root, path: '/agents', component: AgentsPage });

const events = createRoute({ getParentRoute: () => root, path: '/events', component: EventsScreen });
const accounts = createRoute({ getParentRoute: () => root, path: '/accounts', component: AccountsScreen });

// Сервер отдаёт админку по /admin (apps/api/src/main.ts), Vite — с base: '/admin/'.
export const router = createRouter({ routeTree: root.addChildren([people, feed, hosts, agents, events, accounts]), basepath: '/admin' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
