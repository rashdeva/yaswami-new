// Все маршруты админки. Страница здесь — тонкая связка: берёт адрес и раздаёт экрану props; экраны про адреса не знают.
// Ссылки на карточки сущностей рисует components/EntityLink.tsx — второе и последнее место, где известны адреса.
import { createRootRoute, createRoute, createRouter, useNavigate } from '@tanstack/react-router';
import type { AdminEntity, AgentKey, CollectedStatus } from '@yaswami/core';
import { ADMIN_ENTITIES, AGENTS, COLLECTED_STATUSES } from '@yaswami/core';
import { App } from '@/App';
import type { EventsWhen } from '@/hooks/useEvents';
import { AccountsScreen } from '@/screens/AccountsScreen';
import { ActionScreen } from '@/screens/ActionScreen';
import { ActionsScreen } from '@/screens/ActionsScreen';
import { AgentsScreen } from '@/screens/AgentsScreen';
import type { CatalogFilter } from '@/screens/CatalogScreen';
import { CatalogItemScreen } from '@/screens/CatalogItemScreen';
import { CatalogScreen } from '@/screens/CatalogScreen';
import { EventNewScreen } from '@/screens/EventNewScreen';
import { EventScreen } from '@/screens/EventScreen';
import { EventsScreen } from '@/screens/EventsScreen';
import { FeedScreen } from '@/screens/FeedScreen';
import { HostScreen } from '@/screens/HostScreen';
import { HostsScreen } from '@/screens/HostsScreen';
import { PeopleScreen } from '@/screens/PeopleScreen';
import { UserScreen } from '@/screens/UserScreen';
import { UsersScreen } from '@/screens/UsersScreen';

const root = createRootRoute({ component: App });
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const oneOf = <T extends string>(v: unknown, all: readonly T[]) => (all.includes(v as T) ? (v as T) : undefined);

/** «Люди»: выбранный диалог и фильтр по агенту живут в адресе — на них ссылаются «Организаторы», «Агенты» и журнал. */
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
    c: str(search.c),
    agent: typeof search.agent === 'string' && search.agent in AGENTS ? (search.agent as AgentKey) : undefined,
  }),
});

const feed = createRoute({ getParentRoute: () => root, path: '/feed', component: FeedScreen });

function AgentsPage() {
  const navigate = useNavigate();
  return <AgentsScreen onShow={(agent) => void navigate({ to: '/', search: { agent } })} />;
}
const agents = createRoute({ getParentRoute: () => root, path: '/agents', component: AgentsPage });

// --- Организаторы

function HostsPage() {
  const { q } = hosts.useSearch();
  const navigate = useNavigate();
  return <HostsScreen query={q ?? ''} onQuery={(query) => void navigate({ to: '/hosts', search: { q: query || undefined }, replace: true })} onOpen={(c) => void navigate({ to: '/', search: { c } })} />;
}
const hosts = createRoute({ getParentRoute: () => root, path: '/hosts', component: HostsPage, validateSearch: (s: Record<string, unknown>): { q?: string } => ({ q: str(s.q) }) });

function HostPage() {
  const { id } = host.useParams();
  const navigate = useNavigate();
  return <HostScreen id={id} onOpen={(c) => void navigate({ to: '/', search: { c } })} onDeleted={() => void navigate({ to: '/hosts' })} />;
}
const host = createRoute({ getParentRoute: () => root, path: '/hosts/$id', component: HostPage });

// --- События Ясвами

function EventsPage() {
  const { q, when } = events.useSearch();
  const navigate = useNavigate();
  return (
    <EventsScreen
      query={q ?? ''} when={when ?? 'upcoming'}
      onFilter={(f) => void navigate({ to: '/events', search: { q: f.query || undefined, when: f.when === 'upcoming' ? undefined : f.when }, replace: true })}
      onNew={() => void navigate({ to: '/events/new' })}
    />
  );
}
const events = createRoute({
  getParentRoute: () => root,
  path: '/events',
  component: EventsPage,
  validateSearch: (s: Record<string, unknown>): { q?: string; when?: EventsWhen } => ({ q: str(s.q), when: oneOf(s.when, ['upcoming', 'past', 'all'] as const) }),
});

function EventNewPage() {
  const navigate = useNavigate();
  return <EventNewScreen onCreated={(id) => void navigate({ to: '/events/$id', params: { id } })} />;
}
const eventNew = createRoute({ getParentRoute: () => root, path: '/events/new', component: EventNewPage });

function EventPage() {
  const { id } = event.useParams();
  const navigate = useNavigate();
  return <EventScreen id={id} onDeleted={() => void navigate({ to: '/events' })} />;
}
const event = createRoute({ getParentRoute: () => root, path: '/events/$id', component: EventPage });

// --- Каталог: собранные события на модерации и в ленте

function CatalogPage() {
  const { status, q } = catalog.useSearch();
  const navigate = useNavigate();
  return (
    <CatalogScreen
      status={status ?? 'all'} query={q ?? ''}
      onFilter={(f) => void navigate({ to: '/catalog', search: { status: f.status === 'all' ? undefined : f.status, q: f.query || undefined }, replace: true })}
    />
  );
}
const catalog = createRoute({
  getParentRoute: () => root,
  path: '/catalog',
  component: CatalogPage,
  validateSearch: (s: Record<string, unknown>): { status?: CatalogFilter; q?: string } => ({
    status: oneOf<CatalogFilter>(s.status, [...COLLECTED_STATUSES, 'covers'] as (CollectedStatus | 'covers')[]),
    q: str(s.q),
  }),
});

function CatalogItemPage() {
  const { id } = catalogItem.useParams();
  const navigate = useNavigate();
  return <CatalogItemScreen id={id} onDeleted={() => void navigate({ to: '/catalog' })} />;
}
const catalogItem = createRoute({ getParentRoute: () => root, path: '/catalog/$id', component: CatalogItemPage });

// --- Пользователи

function UsersPage() {
  const { q } = users.useSearch();
  const navigate = useNavigate();
  return <UsersScreen query={q ?? ''} onQuery={(query) => void navigate({ to: '/users', search: { q: query || undefined }, replace: true })} />;
}
const users = createRoute({ getParentRoute: () => root, path: '/users', component: UsersPage, validateSearch: (s: Record<string, unknown>): { q?: string } => ({ q: str(s.q) }) });

function UserPage() {
  const { id } = user.useParams();
  const navigate = useNavigate();
  return <UserScreen id={Number(id)} onDeleted={() => void navigate({ to: '/users' })} />;
}
const user = createRoute({ getParentRoute: () => root, path: '/users/$id', component: UserPage });

// --- Журнал

interface ActionsSearch { entity?: AdminEntity; action?: string; actor?: number }
function ActionsPage() {
  const search = actions.useSearch();
  const navigate = useNavigate();
  return <ActionsScreen filter={search} onFilter={(f) => void navigate({ to: '/actions', search: f, replace: true })} />;
}
const actions = createRoute({
  getParentRoute: () => root,
  path: '/actions',
  component: ActionsPage,
  validateSearch: (s: Record<string, unknown>): ActionsSearch => ({
    entity: oneOf(s.entity, ADMIN_ENTITIES),
    action: str(s.action),
    actor: Number.isInteger(Number(s.actor)) && Number(s.actor) > 0 ? Number(s.actor) : undefined,
  }),
});

function ActionPage() {
  const { id } = action.useParams();
  return <ActionScreen id={id} />;
}
const action = createRoute({ getParentRoute: () => root, path: '/actions/$id', component: ActionPage });

const accounts = createRoute({ getParentRoute: () => root, path: '/accounts', component: AccountsScreen });

// Сервер отдаёт админку по /admin (apps/api/src/main.ts), Vite — с base: '/admin/'.
export const router = createRouter({
  routeTree: root.addChildren([people, feed, agents, hosts, host, events, eventNew, event, catalog, catalogItem, users, user, actions, action, accounts]),
  basepath: '/admin',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
