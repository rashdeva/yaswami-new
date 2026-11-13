// Все маршруты приложения. Страница здесь — тонкая связка: берёт адрес, вход и общие вещи layout и раздаёт экрану.
import { createRootRoute, createRoute, createRouter, Navigate, Outlet, redirect, useNavigate } from '@tanstack/react-router';
import { App, AppTabs, Claims, useClaim, useShell } from './App.tsx';
import { hasCredentials, startLogin } from './api.ts';
import { useMyEvents } from './hooks/useMyEvents.ts';
import { useFeature } from './hooks/useFeature.ts';
import { useSession } from './hooks/useSession.ts';
import { useViewed } from './hooks/useViewed.ts';
import { CollectedScreen } from './screens/CollectedScreen.tsx';
import { CreateScreen } from './screens/CreateScreen.tsx';
import { EditScreen } from './screens/EditScreen.tsx';
import { EventScreen } from './screens/EventScreen.tsx';
import { FeedScreen } from './screens/FeedScreen.tsx';
import { HostScreen } from './screens/HostScreen.tsx';
import { HostsScreen } from './screens/HostsScreen.tsx';
import { ListScreen } from './screens/ListScreen.tsx';
import { startParam } from './tg.ts';

const Spinner = () => <div className="state"><div className="spinner" role="status" aria-label="Загрузка" /></div>;
const Failed = ({ error }: { error: Error }) => (
  <div className="state">
    <b>🌧</b>
    <p>{error.message}</p>
    <button className="chip" onClick={() => location.reload()}>Попробовать ещё раз</button>
  </div>
);

// Сколько переходов было: первый — открытие приложения.
let navigations = 0;
const root = createRootRoute({
  beforeLoad: () => {
    // Открыли по ссылке на событие (t.me/<бот>/<приложение>?startapp=<id>) — сразу оно.
    if (++navigations > 1 || !startParam) return;
    throw startParam.startsWith('c_')
      ? redirect({ to: '/e/$id', params: { id: startParam.slice(2) }, replace: true })
      : redirect({ to: '/events/$id', params: { id: startParam }, replace: true });
  },
});

const app = createRoute({ getParentRoute: () => root, id: 'app', component: App });

/** Витрина. В Telegram при открытии приложения сначала показываем своё: есть события — уходим в «Мои». */
function FeedPage() {
  const navigate = useNavigate();
  const { me, city } = useSession();
  const mine = useMyEvents();
  if (hasCredentials && navigations === 1) {
    if (me === undefined) return <Spinner />;
    if (me && mine.failed) return <Failed error={mine.failed} />;
    if (me && mine.total === null) return <Spinner />;
    if (mine.total) return <Navigate to="/my" replace />;
  }
  return <FeedScreen city={city} tabs={<AppTabs />} lead={<Claims />} onOpen={(event) => void navigate({ to: '/e/$id', params: { id: event.id } })} />;
}
const feed = createRoute({ getParentRoute: () => app, path: '/', component: FeedPage });

function CollectedPage() {
  const { id } = collected.useParams();
  const navigate = useNavigate();
  const { me, authed, city, canLogin } = useSession();
  const { toast, onBack } = useShell();
  const claim = useClaim();
  const mine = me?.claimable.find((c) => c.id === id);
  return (
    <CollectedScreen
      key={id}
      id={id}
      city={city}
      authed={authed}
      canLogin={canLogin}
      signedUp={!!me?.collected_signups.includes(id)}
      onClaim={mine ? () => claim(mine) : null}
      onOpenEvent={(eventId) => void navigate({ to: '/events/$id', params: { id: eventId } })}
      onBack={onBack}
      toast={toast}
    />
  );
}
const collected = createRoute({ getParentRoute: () => app, path: '/e/$id', component: CollectedPage });

function HostsPage() {
  const navigate = useNavigate();
  const { city } = useSession();
  return <HostsScreen city={city} tabs={<AppTabs />} onOpen={(host) => void navigate({ to: '/hosts/$id', params: { id: host.id } })} />;
}
const hostsRoute = createRoute({ getParentRoute: () => app, path: '/hosts', component: HostsPage });

function HostPage() {
  const { id } = hostRoute.useParams();
  const navigate = useNavigate();
  const { city } = useSession();
  const { onBack } = useShell();
  return <HostScreen key={id} id={id} city={city} onBack={onBack} onOpenEvent={(event) => void navigate({ to: '/e/$id', params: { id: event.id } })} />;
}
const hostRoute = createRoute({ getParentRoute: () => app, path: '/hosts/$id', component: HostPage });

/** Личные страницы: без входа — приглашение войти. */
function Private() {
  const navigate = useNavigate();
  const { me, canLogin } = useSession();
  if (me === undefined) return <Spinner />;
  if (me) return <Outlet />;
  return canLogin ? (
    <div className="state">
      <b>✨</b>
      <h2>Войдите, чтобы продолжить</h2>
      <p>Свои события и ответы на приглашения доступны после входа через Telegram — без регистрации и паролей.</p>
      <button className="chip" onClick={() => startLogin(location.pathname + location.search)}>Войти через Telegram</button>
      <button className="quiet" onClick={() => void navigate({ to: '/' })}>Смотреть все события</button>
    </div>
  ) : (
    <div className="state">
      <b>✨</b>
      <h2>Откройте в Telegram</h2>
      <p>Свои события и приглашения работают внутри Telegram: так мы узнаём, кто вы, без регистрации и паролей.</p>
      <button className="quiet" onClick={() => void navigate({ to: '/' })}>Смотреть все события</button>
    </div>
  );
}
const personal = createRoute({ getParentRoute: () => app, id: 'private', component: Private });

function ListPage() {
  const navigate = useNavigate();
  const { events, collected: seen, total, failed } = useMyEvents();
  const { onKind } = useShell();
  const canCreate = useFeature('event_create');
  if (failed) return <Failed error={failed} />;
  if (total === null) return <Spinner />;
  if (total === 0 && canCreate) return <Navigate to="/new" replace />; // показывать нечего — организатору предлагаем создать
  return (
    <ListScreen
      events={events ?? []}
      collected={seen}
      tabs={<AppTabs />}
      lead={<Claims />}
      onOpen={(id) => void navigate({ to: '/events/$id', params: { id } })}
      onOpenCollected={(item) => void navigate({ to: '/e/$id', params: { id: item.id } })}
      onNew={canCreate ? () => void navigate({ to: '/new' }) : null}
      onKind={onKind}
    />
  );
}
const list = createRoute({ getParentRoute: () => personal, path: '/my', component: ListPage });

function CreatePage() {
  const navigate = useNavigate();
  const { toast, onKind, onBack } = useShell();
  return <CreateScreen onBack={onBack} onKind={onKind} toast={toast} onCreated={(view) => void navigate({ to: '/events/$id', params: { id: view.event.id } })} />;
}
/** Создание открыто не всем: без возможности `event_create` адрес /new ведёт в «Мои». */
function CreateGate() {
  const canCreate = useFeature('event_create');
  useViewed(canCreate ? 'create_opened' : 'create_denied');
  return canCreate ? <CreatePage /> : <Navigate to="/my" replace />;
}
const create = createRoute({ getParentRoute: () => personal, path: '/new', component: CreateGate });

function EventPage() {
  const { id } = event.useParams();
  const navigate = useNavigate();
  const { me } = useSession();
  const { toast, onKind, onBack } = useShell();
  return <EventScreen key={id} id={id} userId={me?.user.id} onBack={onBack} onKind={onKind} toast={toast} onEdit={() => void navigate({ to: '/events/$id/edit', params: { id } })} />;
}
const event = createRoute({ getParentRoute: () => personal, path: '/events/$id', component: EventPage });

function EditPage({ id, section }: { id: string; section?: string }) {
  const navigate = useNavigate();
  const { toast, onKind, onBack } = useShell();
  return (
    <EditScreen
      key={id}
      id={id}
      section={section === 'main' || section === 'about' ? section : undefined}
      onSection={(next) => void navigate({ to: '/events/$id/edit/$section', params: { id, section: next } })}
      onBack={onBack}
      onKind={onKind}
      toast={toast}
      onSaved={() => void navigate({ to: '/events/$id/edit', params: { id } })}
    />
  );
}
const edit = createRoute({ getParentRoute: () => personal, path: '/events/$id/edit', component: () => <EditPage {...edit.useParams()} /> });
const editSection = createRoute({ getParentRoute: () => personal, path: '/events/$id/edit/$section', component: () => <EditPage {...editSection.useParams()} /> });

export const router = createRouter({
  routeTree: root.addChildren([app.addChildren([feed, collected, hostsRoute, hostRoute, personal.addChildren([list, create, event, edit, editSection])])]),
  defaultNotFoundComponent: () => <Navigate to="/" replace />, // незнакомый адрес — на витрину
});

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}
