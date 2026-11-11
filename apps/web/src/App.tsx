import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppConfig, CollectedEventItem, Event, Me } from '@yaswami/core';
import { collectedPath } from '@yaswami/core';
import type { EventData, EventListData } from './api.ts';
import { api, hasCredentials, loginUrl } from './api.ts';
import { setLinkConfig, tint } from './format.ts';
import { CollectedScreen } from './screens/CollectedScreen.tsx';
import { CreateScreen } from './screens/CreateScreen.tsx';
import { EventScreen } from './screens/EventScreen.tsx';
import { FeedScreen } from './screens/FeedScreen.tsx';
import { ListScreen } from './screens/ListScreen.tsx';
import { Tabs } from './screens/Tabs.tsx';
import { haptic, nativeBack, startParam, tg } from './tg.ts';

// Витрина и собранное событие открыты всем и имеют свой адрес; остальное — личное и требует входа.
type Screen =
  | { name: 'feed' }
  | { name: 'collected'; id: string; initial?: CollectedEventItem }
  | { name: 'list' }
  | { name: 'create' }
  | { name: 'event'; id: string; initial?: EventData };
const isPrivate = (s: Screen | null) => s?.name === 'list' || s?.name === 'create' || s?.name === 'event';

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
  const [screen, setScreen] = useState<Screen | null>(startParam ? { name: 'event', id: startParam } : screenFromPath);
  const [me, setMe] = useState<Me | null | undefined>(undefined); // undefined — ещё выясняем
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [events, setEvents] = useState<EventListData[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [kind, setKind] = useState<Event['kind']>('o');
  const [sheet, setSheet] = useState(false);
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
    const list = await api.events();
    setEvents(list);
    return list;
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

  const go = useCallback((next: Screen) => {
    const path = pathOf(next);
    if (path && path !== location.pathname) history.pushState(null, '', path);
    setScreen(next);
    setSheet(false);
    scrollTo(0, 0);
  }, []);
  useEffect(() => {
    const onPop = () => { setScreen(screenFromPath() ?? { name: 'list' }); setSheet(false); };
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);

  // У публичных экранов свой нейтральный цвет; личные выставляют цвет шаблона события сами.
  const isPublic = screen?.name === 'feed' || screen?.name === 'collected';
  useEffect(() => { if (isPublic) setKind('o'); }, [isPublic]);

  // Куда ведёт «назад»: шторка → закрыть, событие → свой список, создание → список или витрина. null — корень.
  const hasEvents = !!events?.length;
  const toMine = useCallback(() => go({ name: hasEvents ? 'list' : 'create' }), [go, hasEvents]);
  const fromCreate = useCallback(() => go({ name: hasEvents ? 'list' : 'feed' }), [go, hasEvents]);
  const back = sheet
    ? () => setSheet(false)
    : screen?.name === 'collected'
      ? () => go({ name: 'feed' })
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
  const tabs = (current: 'feed' | 'mine') => (
    <Tabs
      current={current}
      me={me ?? null}
      canLogin={canLogin}
      onFeed={() => go({ name: 'feed' })}
      onMine={() => (authed ? toMine() : void (location.href = loginUrl(MINE)))}
      onLogin={() => void (location.href = loginUrl(location.pathname))}
      onLogout={() => void api.logout().then(() => { setMe(null); setEvents(null); go({ name: 'feed' }); }, (e: Error) => showToast(e.message))}
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
    content = <FeedScreen city={city} initial={served.feed} tabs={tabs('feed')} onOpen={(event) => go({ name: 'collected', id: event.id, initial: event })} />;
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
        onSignedUp={onSignedUp}
        onBack={nativeBack ? null : () => go({ name: 'feed' })}
        toast={showToast}
      />
    );
  } else if (screen.name === 'list') {
    content = <ListScreen events={events ?? []} tabs={tabs('mine')} onOpen={(id) => go({ name: 'event', id })} onNew={() => go({ name: 'create' })} onKind={setKind} />;
  } else if (screen.name === 'create') {
    content = (
      <CreateScreen
        onBack={nativeBack ? null : fromCreate}
        onKind={setKind}
        toast={showToast}
        onCreated={(view) => {
          go({ name: 'event', id: view.event.id, initial: view });
          setSheet(true); // сразу предлагаем поделиться
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
        sheet={sheet}
        onSheet={setSheet}
        onBack={nativeBack ? null : () => go({ name: 'list' })}
        onKind={setKind}
        toast={showToast}
        onChanged={() => void loadEvents().catch(() => {})}
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
