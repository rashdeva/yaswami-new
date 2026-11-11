import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppConfig, CollectedEventItem, Event, Me, MyCollectedItem } from '@yaswami/core';
import { collectedPath } from '@yaswami/core';
import type { EventData, EventListData } from './api.ts';
import { api, hasCredentials, loginUrl } from './api.ts';
import { setLinkConfig, tint } from './format.ts';
import { ClaimBanner } from './screens/ClaimBanner.tsx';
import { CollectedScreen } from './screens/CollectedScreen.tsx';
import { CreateScreen } from './screens/CreateScreen.tsx';
import { EventScreen } from './screens/EventScreen.tsx';
import { FeedScreen } from './screens/FeedScreen.tsx';
import type { EditSection } from './screens/EditScreen.tsx';
import { EditScreen } from './screens/EditScreen.tsx';
import { ListScreen } from './screens/ListScreen.tsx';
import { Tabs } from './screens/Tabs.tsx';
import { haptic, nativeBack, startParam, tg } from './tg.ts';

// Витрина и собранное событие открыты всем и имеют свой адрес; остальное — личное и требует входа.
type Screen =
  | { name: 'feed' }
  | { name: 'collected'; id: string; initial?: CollectedEventItem }
  | { name: 'list' }
  | { name: 'create' }
  | { name: 'event'; id: string; initial?: EventData }
  | { name: 'edit'; id: string; section?: EditSection; initial?: EventData };
const isPrivate = (s: Screen | null) => s?.name === 'list' || s?.name === 'create' || s?.name === 'event' || s?.name === 'edit';

// Данные, с которыми сервер отдал страницу (apps/api/src/pages.ts): первый показ обходится без запроса.
const served = (() => {
  try {
    return JSON.parse(document.getElementById('initial')?.textContent ?? '{}') as { feed?: CollectedEventItem[]; event?: CollectedEventItem };
  } catch {
    return {};
  }
})();

const MINE = '/my';
/** Экран по адресу страницы. null — «мои события»: какой именно экран, станет ясно после загрузки списка. */
function screenFromPath(): Screen | null {
  const match = /^\/e\/([^/]+)\/?$/.exec(location.pathname);
  if (match) {
    const id = decodeURIComponent(match[1]!);
    return { name: 'collected', id, initial: served.event?.id === id ? served.event : undefined };
  }
  // В Telegram по корневому адресу сначала показываем своё, на сайте — витрину.
  return location.pathname === MINE || hasCredentials ? null : { name: 'feed' };
}
const pathOf = (s: Screen) => (s.name === 'feed' ? '/' : s.name === 'collected' ? collectedPath(s.id) : s.name === 'list' ? MINE : null);

export function App() {
  // Открыли по ссылке на событие — сразу оно; иначе экран берётся из адреса или выбирается после загрузки списка.
  const [screen, setScreen] = useState<Screen | null>(startParam?.startsWith('c_') ? { name: 'collected', id: startParam.slice(2) } : startParam ? { name: 'event', id: startParam } : screenFromPath);
  const [me, setMe] = useState<Me | null | undefined>(undefined); // undefined — ещё выясняем
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [events, setEvents] = useState<EventListData[] | null>(null);
  const [collected, setCollected] = useState<MyCollectedItem[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const [kind, setKind] = useState<Event['kind']>('o');
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const screenRef = useRef(screen);
  screenRef.current = screen;

  const showToast = useCallback((text: string) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2400);
  }, []);

  const loadEvents = useCallback(async () => {
    // Собранные события — «куда заходил»: их сбой не должен ронять список своих.
    const [list, seen] = await Promise.all([api.events(), api.myCollected().catch(() => [])]);
    setEvents(list);
    setCollected(seen.filter((c) => c.signed_up)); // просто заходили — не показываем
    return { length: list.length + seen.length };
  }, []);

  useEffect(() => {
    api.config().then((c) => { setConfig(c); setLinkConfig(c); }, () => {});
    api.me().then(setMe, () => setMe(null));
  }, []);

  const authed = !!me;
  useEffect(() => {
    if (me === undefined) return;
    if (!authed) {
      // Не вошёл: личные экраны покажут приглашение войти, всё остальное — витрина.
      if (location.pathname !== MINE) setScreen((s) => s ?? { name: 'feed' });
      return;
    }
    loadEvents()
      .then((list) => setScreen((s) => s ?? { name: list.length ? 'list' : location.pathname === MINE ? 'create' : 'feed' }))
      .catch((e: Error) => { if (!screenRef.current || isPrivate(screenRef.current)) setFailed(e.message); });
  }, [me, authed, loadEvents]);

  // Зашёл на собранное событие и вернулся — оно должно появиться в списке.
  const onList = screen?.name === 'list';
  useEffect(() => { if (authed && onList) void loadEvents().catch(() => {}); }, [authed, onList, loadEvents]);

  const go = useCallback((next: Screen) => {
    const path = pathOf(next);
    if (path && path !== location.pathname) history.pushState(null, '', path);
    setScreen(next);
    scrollTo(0, 0);
  }, []);
  useEffect(() => {
    const onPop = () => { setScreen(screenFromPath() ?? { name: 'list' }); };
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);

  // У публичных экранов свой нейтральный цвет; личные выставляют цвет шаблона события сами.
  const isPublic = screen?.name === 'feed' || screen?.name === 'collected';
  useEffect(() => { if (isPublic) setKind('o'); }, [isPublic]);

  // Куда ведёт «назад»: событие → свой список, создание → список или витрина. null — корень.
  const hasEvents = !!events?.length || collected.length > 0;
  const toMine = useCallback(() => go({ name: hasEvents ? 'list' : 'create' }), [go, hasEvents]);
  const fromCreate = useCallback(() => go({ name: hasEvents ? 'list' : 'feed' }), [go, hasEvents]);
  const back = screen?.name === 'collected'
      ? () => go({ name: 'feed' })
      : screen?.name === 'edit'
        ? () => go(screen.section ? { name: 'edit', id: screen.id, initial: screen.initial } : { name: 'event', id: screen.id, initial: screen.initial })
      : screen?.name === 'event'
        ? () => go({ name: 'list' })
        : screen?.name === 'create'
          ? fromCreate
          : null;
  const backRef = useRef(back);
  backRef.current = back;
  const canGoBack = back !== null;

  useEffect(() => {
    if (!nativeBack || !tg) return;
    const onBack = () => {
      haptic.tap();
      backRef.current?.();
    };
    const button = tg.BackButton;
    button.onClick(onBack);
    return () => button.offClick(onBack);
  }, []);
  useEffect(() => {
    if (nativeBack) canGoBack ? tg?.BackButton.show() : tg?.BackButton.hide();
  }, [canGoBack]);

  const city = config?.city ?? 'Дананг';
  // Войти на сайте можно, когда сервер это умеет, а человек открыл страницу не из Telegram.
  const canLogin = !!config?.web_login && !hasCredentials;
  const onSignedUp = useCallback(
    (id: string) => setMe((m) => (m && !m.collected_signups.includes(id) ? { ...m, collected_signups: [...m.collected_signups, id] } : m)),
    [],
  );
  // Организатор подтверждает собранное событие: оно становится его событием Ясвами и открывается сразу.
  const claim = useCallback(async (item: CollectedEventItem) => {
    try {
      const view = await api.claim(item.id);
      haptic.success();
      setMe((m) => m && { ...m, claimable: m.claimable.filter((c) => c.id !== item.id) });
      go({ name: 'event', id: view.event.id, initial: view });
      void loadEvents().catch(() => {});
    } catch (e) {
      haptic.error();
      showToast((e as Error).message);
    }
  }, [go, loadEvents, showToast]);
  const claimBanner = <ClaimBanner items={me?.claimable ?? []} onClaim={claim} />;
  const tabs = (current: 'feed' | 'mine') => (
    <Tabs
      current={current}
      me={me ?? null}
      canLogin={canLogin}
      onFeed={() => go({ name: 'feed' })}
      onMine={() => (authed ? toMine() : void (location.href = loginUrl(MINE)))}
      onLogin={() => void (location.href = loginUrl(location.pathname))}
      onLogout={() => void api.logout().then(() => { setMe(null); setEvents(null); setCollected([]); go({ name: 'feed' }); }, (e: Error) => showToast(e.message))}
    />
  );

  let content;
  if (me === undefined && !isPublic) {
    content = <div className="state"><div className="spinner" role="status" aria-label="Загрузка" /></div>;
  } else if (!authed && !isPublic) {
    content = canLogin ? (
      <div className="state">
        <b>✨</b>
        <h2>Войдите, чтобы продолжить</h2>
        <p>Свои события и ответы на приглашения доступны после входа через Telegram — без регистрации и паролей.</p>
        <button className="chip" onClick={() => void (location.href = loginUrl(location.pathname + location.search))}>Войти через Telegram</button>
        <button className="quiet" onClick={() => go({ name: 'feed' })}>Смотреть все события</button>
      </div>
    ) : (
      <div className="state">
        <b>✨</b>
        <h2>Откройте в Telegram</h2>
        <p>Свои события и приглашения работают внутри Telegram: так мы узнаём, кто вы, без регистрации и паролей.</p>
        <button className="quiet" onClick={() => go({ name: 'feed' })}>Смотреть все события</button>
      </div>
    );
  } else if (failed) {
    content = (
      <div className="state">
        <b>🌧</b>
        <p>{failed}</p>
        <button className="chip" onClick={() => location.reload()}>Попробовать ещё раз</button>
      </div>
    );
  } else if (!screen) {
    content = <div className="state"><div className="spinner" role="status" aria-label="Загрузка" /></div>;
  } else if (screen.name === 'feed') {
    content = <FeedScreen city={city} initial={served.feed} tabs={tabs('feed')} lead={claimBanner} onOpen={(event) => go({ name: 'collected', id: event.id, initial: event })} />;
  } else if (screen.name === 'collected') {
    content = (
      <CollectedScreen
        key={screen.id}
        id={screen.id}
        city={city}
        initial={screen.initial}
        authed={authed}
        canLogin={canLogin}
        signedUp={!!me?.collected_signups.includes(screen.id)}
        onClaim={me?.claimable.some((c) => c.id === screen.id) ? () => claim(me.claimable.find((c) => c.id === screen.id)!) : null}
        onOpenEvent={(eventId) => go({ name: 'event', id: eventId })}
        onSignedUp={onSignedUp}
        onBack={nativeBack ? null : () => go({ name: 'feed' })}
        toast={showToast}
      />
    );
  } else if (screen.name === 'list') {
    content = <ListScreen events={events ?? []} collected={collected} onOpenCollected={(item) => go({ name: 'collected', id: item.id, initial: item })} tabs={tabs('mine')} lead={claimBanner} onOpen={(id) => go({ name: 'event', id })} onNew={() => go({ name: 'create' })} onKind={setKind} />;
  } else if (screen.name === 'create') {
    content = (
      <CreateScreen
        onBack={nativeBack ? null : fromCreate}
        onKind={setKind}
        toast={showToast}
        onCreated={(view) => {
          go({ name: 'event', id: view.event.id, initial: view });
          void loadEvents().catch(() => {});
        }}
      />
    );
  } else if (screen.name === 'edit') {
    content = (
      <EditScreen
        key={screen.id}
        id={screen.id}
        initial={screen.initial}
        section={screen.section}
        onSection={(section) => go({ name: 'edit', id: screen.id, section, initial: screen.initial })}
        onBack={nativeBack ? null : () => go(screen.section ? { name: 'edit', id: screen.id, initial: screen.initial } : { name: 'event', id: screen.id, initial: screen.initial })}
        onKind={setKind}
        toast={showToast}
        onSaved={(view) => {
          go({ name: 'edit', id: screen.id, initial: view });
          void loadEvents().catch(() => {});
        }}
      />
    );
  } else {
    content = (
      <EventScreen
        key={screen.id}
        id={screen.id}
        initial={screen.initial}
        userId={me?.user.id}
        onBack={nativeBack ? null : () => go({ name: 'list' })}
        onKind={setKind}
        toast={showToast}
        onChanged={() => void loadEvents().catch(() => {})}
        onEdit={(view) => go({ name: 'edit', id: screen.id, initial: view })}
      />
    );
  }

  return (
    <div style={tint(kind)}>
      <div className="air" />
      {content}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
