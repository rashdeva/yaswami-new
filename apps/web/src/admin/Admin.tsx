// Админка переписки, экран «Лента» (docs/agents-inbox.md): сверху диалоги, которые ждут нас, ниже — живой поток
// всех сообщений. Управление с клавиатуры; данные обновляются опросом.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Conversation, InboxFeed, Message, Wire } from '@yaswami/core';
import { api, ApiError, loginUrl } from '../api.ts';
import '../tokens.css';
import './admin.css';

type Conv = Wire<Conversation>;
type Msg = Wire<Message>;
// ponytail: опрос раз в 4 секунды; когда диалогов станет много — отдавать только новое или перейти на SSE.
const POLL_MS = 4000;

const time = (iso: string) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('ru', { day: 'numeric', month: 'short' });
};
const who = (c: Conv, m: Msg, me: number) =>
  m.direction === 'in' ? `${c.peer_name} → боту` : `${m.author === 'bot' ? 'Бот' : m.author === 'agent' ? 'Агент' : m.author === `admin:${me}` ? 'Вы' : 'Админ'} → ${c.peer_name}`;
const kind = (m: Msg) => (m.direction === 'in' ? 'user' : m.author === 'bot' || m.author === 'agent' ? 'bot' : 'admin');

function Reply({ onSend }: { onSend: (text: string) => Promise<void> }) {
  const [text, setText] = useState('');
  return (
    <form
      className="ad-reply"
      onSubmit={(e) => {
        e.preventDefault();
        const value = text.trim();
        if (!value) return;
        setText('');
        (document.activeElement as HTMLElement | null)?.blur();
        void onSend(value);
      }}
    >
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ответить самому — Enter отправит, бот в этом диалоге замолчит" />
    </form>
  );
}

export default function Admin() {
  const [feed, setFeed] = useState<Wire<InboxFeed> | null>(null);
  const [problem, setProblem] = useState<string | null>(null); // код ошибки загрузки
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState(''); // ключ выбранной строки: c:<диалог> или m:<сообщение>
  const [thread, setThread] = useState<Msg[] | null>(null); // вся переписка выбранного диалога; null — закрыта
  const root = useRef<HTMLDivElement>(null);
  const seen = useRef<Set<string> | null>(null); // сообщения, которые были при первой загрузке: остальные подсвечиваем

  const load = useCallback(
    () =>
      api.inbox().then(
        (f) => {
          seen.current ??= new Set(f.messages.map((m) => m.id));
          setFeed(f);
          setProblem(null);
        },
        (e: unknown) => setProblem(e instanceof ApiError ? e.code : 'internal'),
      ),
    [],
  );
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const byId = new Map(feed?.conversations.map((c) => [c.id, c]));
  const pinned = feed?.conversations.filter((c) => c.attention) ?? [];
  const events = (feed?.messages ?? []).flatMap((m) => {
    const c = byId.get(m.conversation_id);
    return c ? [{ c, m }] : [];
  });
  const rows = [...pinned.map((c) => ({ key: `c:${c.id}`, c })), ...events.map(({ c, m }) => ({ key: `m:${m.id}`, c }))];
  const at = Math.max(0, rows.findIndex((r) => r.key === selected));
  const cur = rows[at];
  const curId = cur?.c.id;
  const newest = feed?.messages[0]?.id;

  const act = async (action: Promise<unknown>) => {
    try {
      await action;
      setNotice('');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Не получилось');
    }
    await load();
  };
  const send = (c: Conv) => (text: string) => act(api.inboxSend(c.id, text));

  // Открытая переписка следует за выбранным диалогом и обновляется вместе с лентой.
  const open = thread !== null;
  useEffect(() => {
    if (open && curId) void api.inboxThread(curId).then(setThread, () => {});
  }, [open, curId, newest]);

  useEffect(() => {
    const focus = () => root.current?.querySelector<HTMLElement>('.sel input')?.focus();
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest('input, textarea');
      if (e.key === 'Escape') return typing ? (typing as HTMLElement).blur() : setThread(null);
      if (typing || !cur || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (e.key === 'ArrowDown' || key === 'j') setSelected(rows[Math.min(at + 1, rows.length - 1)]!.key);
      else if (e.key === 'ArrowUp' || key === 'k') setSelected(rows[Math.max(at - 1, 0)]!.key);
      else if (e.key === 'Enter' || key === 'r' || key === 'к') focus();
      else if (key === 't' || key === 'е') void act(api.inboxUpdate(cur.c.id, { mode: cur.c.mode === 'agent' ? 'human' : 'agent', attention: null }));
      else if (key === 'd' || key === 'в') void act(api.inboxUpdate(cur.c.id, { attention: null }));
      else if (key === 'o' || key === 'щ') setThread(open ? null : []);
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });
  useEffect(() => root.current?.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }), [at]);

  if (!feed) {
    return (
      <div className="ad-gate">
        {problem === 'unauthorized' && <a className="ad-btn" href={loginUrl('/admin')}>Войти через Telegram</a>}
        {problem === 'forbidden' && <p>У этого аккаунта нет доступа к админке.</p>}
        {problem && problem !== 'unauthorized' && problem !== 'forbidden' && <p>Не получилось загрузить переписку. Повторяю…</p>}
      </div>
    );
  }

  return (
    <div className="ad" ref={root}>
      <header className="ad-strip">
        <h1>Я с вами · переписка</h1>
        <span className="ad-pill">Ждут вас: {pinned.length}</span>
        <span className="ad-pill">Диалогов: {feed.conversations.length}</span>
        <i />
        {(notice || problem) && <span className="ad-pill warn">{notice || 'Нет связи с сервером'}</span>}
        <span className="ad-hint">↑↓ по ленте · Enter ответить · T взять / вернуть боту · D готово · O переписка · Esc</span>
      </header>
      <main>
        <div className="ad-col">
          <h2>Ждут вас <b className="ad-badge">{pinned.length}</b></h2>
          {pinned.length === 0 && <p className="ad-hint">Никто не ждёт. Ниже видно всё, что происходит.</p>}
          {pinned.map((c) => (
            <div key={c.id} className={`ad-pin ${cur?.key === `c:${c.id}` ? 'sel' : ''}`} onClick={() => setSelected(`c:${c.id}`)}>
              <div className="ad-row">
                <span>
                  <strong>{c.peer_name}</strong> {c.peer_username && <span className="ad-hint">@{c.peer_username}</span>}{' '}
                  {c.mode === 'human' && <b className="ad-tag">ведёте вы</b>}
                </span>
                <b className="ad-tag bad">{c.attention}</b>
              </div>
              {feed.messages.filter((m) => m.conversation_id === c.id && m.direction === 'in').slice(0, 2).reverse().map((m) => (
                <div key={m.id} className="ad-quote">{m.text}</div>
              ))}
              <Reply onSend={send(c)} />
            </div>
          ))}

          <h2>Лента <span className="ad-live">идёт</span></h2>
          {events.length === 0 && <p className="ad-hint">Пока никто не писал боту.</p>}
          {events.map(({ c, m }) => {
            const sel = cur?.key === `m:${m.id}`;
            return (
              <div key={m.id} className={`ad-ev ${kind(m)} ${sel ? 'sel' : ''} ${seen.current?.has(m.id) ? '' : 'fresh'}`} onClick={() => setSelected(`m:${m.id}`)}>
                <span className="ad-time">{time(m.created_at)}</span>
                <div>
                  <div className="ad-who">
                    {who(c, m, feed.me)} {c.mode === 'human' && <b className="ad-tag">ведёте вы</b>}
                    {m.status === 'failed' && <b className="ad-tag bad">не доставлено</b>}
                  </div>
                  <div className="ad-text">{m.text}</div>
                  {sel && <Reply onSend={send(c)} />}
                </div>
              </div>
            );
          })}
        </div>
      </main>
      {thread && cur && (
        <aside className="ad-drawer">
          <header className="ad-row">
            <span>
              <strong>{cur.c.peer_name}</strong> {cur.c.peer_username && <span className="ad-hint">@{cur.c.peer_username}</span>}
              <div className="ad-hint">{cur.c.mode === 'human' ? 'Диалог ведёте вы' : 'Отвечает бот'}</div>
            </span>
            <button className="ad-btn ghost" onClick={() => setThread(null)}>Закрыть</button>
          </header>
          <div className="ad-thread">
            {thread.map((m) => (
              <div key={m.id} className={`ad-msg ${kind(m)}`}>
                <div className="ad-bubble">{m.text}</div>
                <div className="ad-hint">{who(cur.c, m, feed.me)} · {m.status === 'failed' ? 'не доставлено' : time(m.created_at)}</div>
              </div>
            ))}
          </div>
          <Reply onSend={send(cur.c)} />
        </aside>
      )}
    </div>
  );
}
