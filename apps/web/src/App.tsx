import { useCallback, useEffect, useRef, useState } from 'react';
import type { Event } from '@yaswami/core';
import type { EventData, EventListData } from './api.ts';
import { api, canAuth } from './api.ts';
import { tint } from './format.ts';
import { CreateScreen } from './screens/CreateScreen.tsx';
import { EventScreen } from './screens/EventScreen.tsx';
import { ListScreen } from './screens/ListScreen.tsx';
import { haptic, nativeBack, startParam, tg } from './tg.ts';

type Screen = { name: 'list' } | { name: 'create' } | { name: 'event'; id: string; initial?: EventData };

export function App() {
  // Открыли по ссылке на событие — сразу оно; иначе экран выбирается после загрузки списка.
  const [screen, setScreen] = useState<Screen | null>(startParam ? { name: 'event', id: startParam } : null);
  const [events, setEvents] = useState<EventListData[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [kind, setKind] = useState<Event['kind']>('o');
  const [sheet, setSheet] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

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
    if (!canAuth) return;
    loadEvents()
      .then((list) => setScreen((s) => s ?? { name: list.length ? 'list' : 'create' }))
      .catch((e: Error) => setFailed(e.message));
  }, [loadEvents]);

  const go = useCallback((next: Screen) => {
    setScreen(next);
    setSheet(false);
    scrollTo(0, 0);
  }, []);

  // Куда ведёт «назад»: шторка → закрыть, событие → список, создание → список (если есть что показать). null — корень.
  const hasEvents = !!events?.length;
  const back = sheet
    ? () => setSheet(false)
    : screen?.name === 'event' || (screen?.name === 'create' && hasEvents)
      ? () => go({ name: 'list' })
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

  let content;
  if (!canAuth) {
    content = (
      <div className="state">
        <b>✨</b>
        <h2>Откройте в Telegram</h2>
        <p>Приложение работает внутри Telegram: так мы узнаём, кто вы, без регистрации и паролей.</p>
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
  } else if (screen.name === 'list') {
    content = <ListScreen events={events ?? []} onOpen={(id) => go({ name: 'event', id })} onNew={() => go({ name: 'create' })} onKind={setKind} />;
  } else if (screen.name === 'create') {
    content = (
      <CreateScreen
        onBack={!nativeBack && hasEvents ? () => go({ name: 'list' }) : null}
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
