// Админка переписки, экран «Лента» (docs/agents-inbox.md): сверху диалоги, которые ждут нас, ниже — живой поток
// всех сообщений. Управление с клавиатуры; данные обновляются опросом.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Conversation, InboxFeed, Message, TgAccount, Wire } from '@yaswami/core';
import { api, ApiError, loginUrl } from '../api.ts';
import '../tokens.css';
import './admin.css';

type Conv = Wire<Conversation>;
type Msg = Wire<Message>;
type Account = Wire<TgAccount>;
// ponytail: опрос раз в 4 секунды; когда диалогов станет много — отдавать только новое или перейти на SSE.
const POLL_MS = 4000;

const time = (iso: string) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('ru', { day: 'numeric', month: 'short' });
};
const who = (c: Conv, m: Msg, me: number, via: string) =>
  m.direction === 'in'
    ? `${c.peer_name} → ${via}`
    : `${m.author === 'bot' ? 'Бот' : m.author.startsWith('agent') ? 'Агент' : m.author === `admin:${me}` ? 'Вы' : 'Админ'} → ${c.peer_name}${c.channel === 'account' ? ` · ${via}` : ''}`;
const kind = (m: Msg) => (m.direction === 'in' ? 'user' : m.author === 'bot' || m.author.startsWith('agent') ? 'bot' : 'admin');

const ACCOUNT_STATUS: Record<Account['status'], string> = {
  login_requested: 'Запрашиваем код у Telegram…',
  login_code: 'Введите код, который пришёл в Telegram на этот номер',
  login_password: 'Введите пароль двухэтапной проверки',
  active: 'На связи',
  error: 'Ошибка входа',
};

/** Аккаунты Telegram, с которых мы пишем людям: добавить, пройти вход по шагам, удалить. */
function Accounts({ accounts, act }: { accounts: Account[]; act: (action: Promise<unknown>) => Promise<void> }) {
  const [label, setLabel] = useState('');
  const [phone, setPhone] = useState('');
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  return (
    <section className="ad-accounts">
      <h2>Аккаунты Telegram</h2>
      {accounts.length === 0 && <p className="ad-hint">Пока нет ни одного. Нужен отдельный, не личный номер: аккаунт могут заблокировать.</p>}
      {accounts.map((a) => (
        <div key={a.id} className="ad-account">
          <div className="ad-row">
            <span><strong>{a.label}</strong> <span className="ad-hint">{a.phone}</span></span>
            <span className={`ad-tag ${a.status === 'active' ? 'ok' : a.status === 'error' ? 'bad' : ''}`}>
              {a.status === 'active' ? 'На связи' : a.status === 'error' ? 'Ошибка входа' : 'Идёт вход'}
            </span>
          </div>
          {a.status.startsWith('login_') && <div className="ad-hint">{ACCOUNT_STATUS[a.status]}</div>}
          {a.last_error && <div className="ad-hint warn">{a.last_error}</div>}
          {(a.status === 'login_code' || a.status === 'login_password') && (
            <form
              className="ad-inline"
              onSubmit={(e) => {
                e.preventDefault();
                const secret = secrets[a.id]?.trim();
                if (!secret) return;
                setSecrets({ ...secrets, [a.id]: '' });
                void act(api.accountLogin(a.id, secret));
              }}
            >
              <input
                type={a.status === 'login_password' ? 'password' : 'text'} autoComplete="off" value={secrets[a.id] ?? ''}
                onChange={(e) => setSecrets({ ...secrets, [a.id]: e.target.value })} placeholder={a.status === 'login_code' ? 'Код из Telegram' : 'Пароль'}
              />
              <button className="ad-btn">Отправить</button>
            </form>
          )}
          <button className="ad-link" onClick={() => confirm(`Удалить аккаунт «${a.label}»? Его переписка останется, но писать в неё будет не с чего.`) && void act(api.accountDelete(a.id))}>Удалить</button>
        </div>
      ))}
      <form
        className="ad-inline"
        onSubmit={(e) => {
          e.preventDefault();
          void act(api.accountCreate({ label: label.trim(), phone: phone.replace(/[\s()-]/g, '') })).then(() => (setLabel(''), setPhone('')));
        }}
      >
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Название, например «Аня»" required maxLength={40} />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+84 …" required inputMode="tel" />
        <button className="ad-btn">Добавить</button>
      </form>
    </section>
  );
}

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
  const [showAccounts, setShowAccounts] = useState(false);
  const [edited, setEdited] = useState<Record<string, string>>({}); // наши правки черновиков агента: id сообщения → текст
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
  const labels = new Map(feed?.accounts.map((a) => [a.id, a.label]));
  // Через что идёт диалог: бот или наш аккаунт.
  const via = (c: Conv) => (c.channel === 'bot' ? 'боту' : `аккаунт «${labels.get(c.account_id ?? '') ?? 'удалён'}»`);
  const pinned = feed?.conversations.filter((c) => c.attention) ?? [];
  // Черновики агента в ленту не идут: они ждут решения в «Ждут вас».
  const drafts = new Map((feed?.messages ?? []).filter((m) => m.status === 'draft').map((m) => [m.conversation_id, m]));
  const events = (feed?.messages ?? []).flatMap((m) => {
    const c = byId.get(m.conversation_id);
    return c && m.status !== 'draft' ? [{ c, m }] : [];
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
    const focus = (selector = 'input, textarea') => root.current?.querySelector<HTMLElement>(`.sel ${selector}`)?.focus();
    const draft = cur && drafts.get(cur.c.id);
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest('input, textarea');
      if (e.key === 'Escape') return typing ? (typing as HTMLElement).blur() : setThread(null);
      // В черновике Enter — перенос строки, отправка — Cmd/Ctrl+Enter.
      if (typing && draft && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) return void act(api.draftSend(draft.id, edited[draft.id]));
      if (typing || !cur || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (e.key === 'ArrowDown' || key === 'j') setSelected(rows[Math.min(at + 1, rows.length - 1)]!.key);
      else if (e.key === 'ArrowUp' || key === 'k') setSelected(rows[Math.max(at - 1, 0)]!.key);
      else if (e.key === 'Enter' && draft) void act(api.draftSend(draft.id, edited[draft.id]));
      else if ((key === 'x' || key === 'ч') && draft) void act(api.draftReject(draft.id));
      else if (e.key === 'Enter' || key === 'r' || key === 'к' || key === 'e' || key === 'у') focus();
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
        <button className="ad-btn ghost" onClick={() => setShowAccounts(!showAccounts)}>Аккаунты: {feed.accounts.filter((a) => a.status === 'active').length}</button>
        <i />
        {(notice || problem) && <span className="ad-pill warn">{notice || 'Нет связи с сервером'}</span>}
        <span className="ad-hint">↑↓ по ленте · Enter ответить или отправить черновик · X отклонить черновик · T взять / вернуть боту · D готово · O переписка · Esc</span>
      </header>
      <main>
        <div className="ad-col">
          {showAccounts && <Accounts accounts={feed.accounts} act={act} />}
          <h2>Ждут вас <b className="ad-badge">{pinned.length}</b></h2>
          {pinned.length === 0 && <p className="ad-hint">Никто не ждёт. Ниже видно всё, что происходит.</p>}
          {pinned.map((c) => (
            <div key={c.id} className={`ad-pin ${cur?.key === `c:${c.id}` ? 'sel' : ''}`} onClick={() => setSelected(`c:${c.id}`)}>
              <div className="ad-row">
                <span>
                  <strong>{c.peer_name}</strong> {c.peer_username && <span className="ad-hint">@{c.peer_username}</span>}{' '}
                  {c.channel === 'account' && <span className="ad-hint">{via(c)}</span>}{' '}
                  {c.mode === 'human' && <b className="ad-tag">ведёте вы</b>}
                </span>
                <b className="ad-tag bad">{c.attention}</b>
              </div>
              {feed.messages.filter((m) => m.conversation_id === c.id && m.direction === 'in').slice(0, 2).reverse().map((m) => (
                <div key={m.id} className="ad-quote">{m.text}</div>
              ))}
              {drafts.has(c.id) ? (
                ((draft) => (
                  <>
                    <div className="ad-hint warn">
                      Агент предлагает ответить{draft.meta?.reply_to ? ' в чате' : ''}. {draft.meta?.reason}
                      {draft.meta?.source_url && <> · <a href={draft.meta.source_url} target="_blank" rel="noreferrer">открыть сообщение</a></>}
                    </div>
                    <textarea rows={3} value={edited[draft.id] ?? draft.text} onChange={(e) => setEdited({ ...edited, [draft.id]: e.target.value })} />
                    <div className="ad-inline">
                      <button className="ad-btn" onClick={() => void act(api.draftSend(draft.id, edited[draft.id]))}>Отправить</button>
                      <button className="ad-btn ghost" onClick={() => void act(api.draftReject(draft.id))}>Отклонить</button>
                    </div>
                  </>
                ))(drafts.get(c.id)!)
              ) : (
                <Reply onSend={send(c)} />
              )}
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
                    {who(c, m, feed.me, via(c))} {c.mode === 'human' && <b className="ad-tag">ведёте вы</b>}
                    {m.status === 'queued' && <b className="ad-tag">отправляется</b>}
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
                <div className="ad-hint">{who(cur.c, m, feed.me, via(cur.c))} · {m.status === 'failed' ? 'не доставлено' : m.status === 'queued' ? 'отправляется' : m.status === 'draft' ? 'черновик, не отправлено' : time(m.created_at)}</div>
              </div>
            ))}
          </div>
          <Reply onSend={send(cur.c)} />
        </aside>
      )}
    </div>
  );
}
