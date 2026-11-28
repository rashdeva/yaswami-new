// Все маршруты приложения. Страница здесь — тонкая связка: берёт адрес, вход и общие вещи layout и раздаёт экрану.
import { useCallback } from 'react';
import { createRootRoute, createRoute, createRouter, Navigate, Outlet, redirect, useNavigate } from '@tanstack/react-router';
import type { SearchEntry, Wire } from '@yaswami/core';
import { App, Claims, useClaim, useLogout, useShell } from './App.tsx';
import { startLogin } from './api.ts';
import { useMyEvents } from './hooks/useMyEvents.ts';
import { useFeature } from './hooks/useFeature.ts';
import { contactMatch, useHostSearches } from './hooks/useHostSearches.ts';
import { useCity, useSession } from './hooks/useSession.ts';
import { SourceSuggest } from './screens/SourceSuggest.tsx';
import { useViewed } from './hooks/useViewed.ts';
import { CollectedScreen } from './screens/CollectedScreen.tsx';
import { EditScreen } from './screens/EditScreen.tsx';
import { EventScreen } from './screens/EventScreen.tsx';
import { FeedScreen } from './screens/FeedScreen.tsx';
import { HostScreen } from './screens/HostScreen.tsx';
import { HostsScreen } from './screens/HostsScreen.tsx';
import { ListScreen } from './screens/ListScreen.tsx';
import { ProductScreen } from './screens/ProductScreen.tsx';
import { ProductsScreen } from './screens/ProductsScreen.tsx';
import { ProfileScreen } from './screens/ProfileScreen.tsx';
import { PeopleScreen } from './screens/PeopleScreen.tsx';
import { ServiceGroupScreen } from './screens/ServiceGroupScreen.tsx';
import { ShelfScreen } from './screens/ShelfScreen.tsx';
import { DirectionScreen } from './screens/DirectionScreen.tsx';
import { AllEventsScreen } from './screens/AllEventsScreen.tsx';
import { AddScreen } from './screens/AddScreen.tsx';
import { isAddKind } from './add.ts';
import type { AddKind } from './add.ts';
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

/**
 * Запрос строки поиска живёт в адресе (?q=) и у «Событий», и у «Услуг»: находками можно поделиться ссылкой,
 * а «назад» браузера возвращает к ним. Отдельного экрана поиска нет.
 */
const withQuery = (search: Record<string, unknown>): { q?: string } => (typeof search.q === 'string' && search.q ? { q: search.q } : {});

/** Куда ведёт находка поиска. У услуги своей страницы нет — её мастер (вкладка «Услуги» вместо этого открывает шторку). */
function useOpenEntry() {
  const navigate = useNavigate();
  return (entry: Wire<SearchEntry>) => void (entry.type === 'event'
    ? navigate({ to: '/e/$id', params: { id: entry.event.id } })
    : entry.type === 'product'
      ? navigate({ to: '/products/$id', params: { id: entry.product.id } })
      : navigate({ to: '/hosts/$id', params: { id: entry.host.id } }));
}

/** Витрина — главная и в Telegram, и на сайте; свои события — за аватаркой. */
function FeedPage() {
  const { q = '' } = feed.useSearch();
  const navigate = useNavigate();
  const { authed, canLogin } = useSession();
  const { city_id } = useCity();
  return (
    <FeedScreen
      lead={<Claims />}
      tail={<SourceSuggest city_id={city_id} authed={authed} onLogin={canLogin ? () => startLogin('/') : null} />}
      onOpen={(event) => void navigate({ to: '/e/$id', params: { id: event.id } })}
      onOpenShelf={(id) => void navigate({ to: '/s/$id', params: { id } })}
      onOpenDirection={(slug) => void navigate({ to: '/d/$slug', params: { slug } })}
      onOpenAll={() => void navigate({ to: '/all' })}
      query={q}
      onQuery={(next) => void navigate({ to: '/', search: { q: next || undefined }, replace: true })}
      onOpenEntry={useOpenEntry()}
    />
  );
}
const feed = createRoute({ getParentRoute: () => app, path: '/', component: FeedPage, validateSearch: withQuery });

/** Полка витрины целиком (ADR-0009). Данные — из уже загруженной витрины. */
function ShelfPage() {
  const { id } = shelfRoute.useParams();
  const navigate = useNavigate();
  const { onBack } = useShell();
  const gone = useCallback(() => void navigate({ to: '/', replace: true }), [navigate]);
  return <ShelfScreen key={id} id={id} onBack={onBack} onOpen={(event) => void navigate({ to: '/e/$id', params: { id: event.id } })} onGone={gone} />;
}
const shelfRoute = createRoute({ getParentRoute: () => app, path: '/s/$id', component: ShelfPage });

/** Направление: его темы и события (CONTEXT.md). */
function DirectionPage() {
  const { slug } = directionRoute.useParams();
  const navigate = useNavigate();
  const { onBack } = useShell();
  const { authed, canLogin } = useSession();
  const { city_id } = useCity();
  const gone = useCallback(() => void navigate({ to: '/', replace: true }), [navigate]);
  return (
    <DirectionScreen
      key={slug}
      slug={slug}
      onBack={onBack}
      onOpen={(event) => void navigate({ to: '/e/$id', params: { id: event.id } })}
      onGone={gone}
      empty={<SourceSuggest city_id={city_id} authed={authed} onLogin={canLogin ? () => startLogin(`/d/${slug}`) : null} />}
    />
  );
}
const directionRoute = createRoute({ getParentRoute: () => app, path: '/d/$slug', component: DirectionPage });

/** Все события: день по частям. */
function AllEventsPage() {
  const navigate = useNavigate();
  const { onBack } = useShell();
  return <AllEventsScreen onBack={onBack} onOpen={(event) => void navigate({ to: '/e/$id', params: { id: event.id } })} />;
}
const allRoute = createRoute({ getParentRoute: () => app, path: '/all', component: AllEventsPage });

function CollectedPage() {
  const { id } = collected.useParams();
  const navigate = useNavigate();
  const { me, authed, canLogin } = useSession();
  const { toast, onBack } = useShell();
  const claim = useClaim();
  const mine = me?.claimable.find((c) => c.id === id);
  return (
    <CollectedScreen
      key={id}
      id={id}
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
  const { q = '' } = hostsRoute.useSearch();
  const navigate = useNavigate();
  const { city } = useSession();
  return (
    <HostsScreen
      city={city}
      query={q}
      onQuery={(next) => void navigate({ to: '/services', search: { q: next || undefined }, replace: true })}
      onOpenGroup={(key) => void navigate({ to: '/services/$group', params: { group: key } })}
      onOpenHost={(host) => void navigate({ to: '/hosts/$id', params: { id: host.id } })}
      onOpenEntry={useOpenEntry()}
      onAdd={() => void navigate({ to: '/add', search: { kind: 'service' } })}
    />
  );
}
const hostsRoute = createRoute({ getParentRoute: () => app, path: '/services', component: HostsPage, validateSearch: withQuery });

/** Раздел «Услуг» целиком: все услуги направления (или темы без направления). */
function ServiceGroupPage() {
  const { group } = serviceGroupRoute.useParams();
  const navigate = useNavigate();
  const { city } = useSession();
  const { onBack } = useShell();
  const gone = useCallback(() => void navigate({ to: '/services', replace: true }), [navigate]);
  return <ServiceGroupScreen key={group} groupKey={group} city={city} onBack={onBack} onGone={gone} onOpenHost={(host) => void navigate({ to: '/hosts/$id', params: { id: host.id } })} />;
}
const serviceGroupRoute = createRoute({ getParentRoute: () => app, path: '/services/$group', component: ServiceGroupPage });
// Старый адрес вкладки: раньше она называлась «Организаторы». Страница мастера осталась на /hosts/$id — это Host.
const oldHostsRoute = createRoute({ getParentRoute: () => app, path: '/hosts', beforeLoad: () => { throw redirect({ to: '/services', replace: true }); } });

function HostPage() {
  const { id } = hostRoute.useParams();
  const navigate = useNavigate();
  const { city, me } = useSession();
  const { onBack } = useShell();
  return (
    <HostScreen key={id} id={id} city={city} onBack={onBack}
      own={me?.host_id === id}
      onOpenEvent={(event) => void navigate({ to: '/e/$id', params: { id: event.id } })}
      onOpenProduct={(product) => void navigate({ to: '/products/$id', params: { id: product.id } })} />
  );
}
const hostRoute = createRoute({ getParentRoute: () => app, path: '/hosts/$id', component: HostPage });

/** Товары мастеров — вкладка таббара, когда мастеров набралось; по прямой ссылке открывается всегда. */
function ProductsPage() {
  const navigate = useNavigate();
  const { city } = useSession();
  return <ProductsScreen city={city} onOpen={(product) => void navigate({ to: '/products/$id', params: { id: product.id } })} onAdd={() => void navigate({ to: '/add', search: { kind: 'product' } })} />;
}
const productsRoute = createRoute({ getParentRoute: () => app, path: '/products', component: ProductsPage });

function ProductPage() {
  const { id } = productRoute.useParams();
  const navigate = useNavigate();
  const { city } = useSession();
  const { onBack } = useShell();
  return <ProductScreen key={id} id={id} city={city} onBack={onBack} onOpenHost={(hostId) => void navigate({ to: '/hosts/$id', params: { id: hostId } })} />;
}
const productRoute = createRoute({ getParentRoute: () => app, path: '/products/$id', component: ProductPage });

/** Добавить событие, товар или услугу: форм нет, экран отправляет в бота. Открыт и гостю: войти нужно только в Telegram. */
function AddPage() {
  const { kind } = addRoute.useSearch();
  const { onBack } = useShell();
  return <AddScreen kind={kind ?? 'event'} onBack={onBack} />;
}
const addRoute = createRoute({
  getParentRoute: () => app, path: '/add', component: AddPage,
  validateSearch: (s: Record<string, unknown>): { kind?: AddKind } => ({ kind: isAddKind(s.kind) ? s.kind : undefined }),
});

// Старый адрес поиска: теперь это строка в шапке витрины.
const searchRoute = createRoute({
  getParentRoute: () => app, path: '/search', validateSearch: withQuery,
  beforeLoad: ({ search }) => { throw redirect({ to: '/', search, replace: true }); },
});

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

/** Мои события — в профиле вошедшего. */
function MyEvents() {
  const navigate = useNavigate();
  const { events, collected: seen, total, failed } = useMyEvents();
  const { onKind } = useShell();
  const logout = useLogout();
  const { me } = useSession();
  if (failed) return <Failed error={failed} />;
  if (total === null) return <Spinner />;
  return (
    <ListScreen
      events={events ?? []}
      collected={seen}
      lead={<Claims />}
      onOpen={(id) => void navigate({ to: '/events/$id', params: { id } })}
      onOpenCollected={(item) => void navigate({ to: '/e/$id', params: { id: item.id } })}
      onLogout={logout}
      onNew={() => void navigate({ to: '/add' })}
      onPeople={me?.host_id ? () => void navigate({ to: '/people' }) : null}
      onKind={onKind}
    />
  );
}

/** Профиль: открыт и гостю — у него город и вход; у вошедшего ещё темы, уведомления и мои события. */
function ProfilePage() {
  const { me, canLogin } = useSession();
  const canCreate = useFeature('event_create');
  const { onBack } = useShell();
  if (me === undefined) return <Spinner />;
  return (
    <ProfileScreen name={me?.user.first_name ?? null} host={!!me?.host_id || canCreate} onLogin={!me && canLogin ? () => startLogin('/my') : null} onBack={onBack}>
      {me && <MyEvents />}
    </ProfileScreen>
  );
}
const list = createRoute({ getParentRoute: () => app, path: '/my', component: ProfilePage });

/** Поиск людей — только подтверждённому организатору; остальным адрес ведёт в «Мои». */
function PeoplePage() {
  const { me } = useSession();
  const { toast } = useShell();
  const { searches, matches, failed, create, setActive, remove } = useHostSearches();
  if (!me?.host_id) return <Navigate to="/my" replace />;
  if (failed) return <Failed error={failed} />;
  if (!searches || !matches) return <Spinner />;
  return <PeopleScreen searches={searches} matches={matches} onCreate={create} onActive={setActive} onRemove={remove} onContact={contactMatch} toast={toast} />;
}
const people = createRoute({ getParentRoute: () => personal, path: '/people', component: PeoplePage });

// Формы создания больше нет: событие, как товар и услугу, человек описывает боту (экран «Добавить»). Старый адрес ведёт туда.
const create = createRoute({ getParentRoute: () => personal, path: '/new', beforeLoad: () => { throw redirect({ to: '/add', search: { kind: 'event' }, replace: true }); } });

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
  routeTree: root.addChildren([app.addChildren([feed, shelfRoute, directionRoute, allRoute, collected, hostsRoute, serviceGroupRoute, oldHostsRoute, hostRoute, productsRoute, productRoute, addRoute, searchRoute, list, personal.addChildren([people, create, event, edit, editSection])])]),
  defaultNotFoundComponent: () => <Navigate to="/" replace />, // незнакомый адрес — на витрину
});

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}
