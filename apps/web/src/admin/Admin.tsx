// Админка переписки, экран «Лента» (docs/agents-inbox.md): сверху диалоги, которые ждут нас, ниже — живой поток
// всех сообщений. Управление с клавиатуры; данные обновляются опросом.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminOverview, AgentKey, InboxConversation, InboxFeed, Message, TgAccount, Wire } from '@yaswami/core';
import { AGENTS, INBOX_STAGES } from '@yaswami/core';
import { api, ApiError, loginUrl } from '../api.ts';
import { Events, useModeration } from './Events.tsx';
import '../tokens.css';
import './admin.css';

type Conv = Wire<InboxConversation>;
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
/** Какой агент написал сообщение: `agent:<роль>`, у оператора — просто `agent`. */
const agentOf = (author: string): AgentKey | null => {
  if (!author.startsWith('agent')) return null;
  const role = author.split(':')[1] ?? 'operator';
  return role in AGENTS ? (role as AgentKey) : null;
};
/** Кто отправитель с нашей стороны: бот сам, один из агентов или человек из команды. */
const sender = (m: Msg, me: number) => {
  const agent = agentOf(m.author);
  return m.author === 'bot' ? 'Бот (автоответ)' : agent ? `Агент «${AGENTS[agent].name}»` : m.author === `admin:${me}` ? 'Вы' : 'Человек из команды';
};
const who = (c: Conv, m: Msg, me: number, via: string) =>
  m.direction === 'in' ? `${c.peer_name} → ${via}` : `${sender(m, me)} → ${c.peer_name}${c.channel === 'account' ? ` · ${via}` : ''}`;
/** Кто сейчас отвечает в диалоге. */
const leads = (c: Conv) => (c.mode === 'human' ? 'ведёте вы' : c.agent ? `ведёт агент «${AGENTS[c.agent].name}»` : c.channel === 'bot' ? 'отвечает бот' : 'никто не ведёт');
const kind = (m: Msg) => (m.direction === 'in' ? 'user' : m.author === 'bot' ? 'bot' : m.author.startsWith('agent') ? 'agent' : 'admin');

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

const STATUS_TEXT = (m: Msg) =>
  m.status === 'failed' ? 'не доставлено' : m.status === 'queued' ? 'отправляется' : m.status === 'draft' ? 'черновик, не отправлено' : time(m.created_at);

type Filter = 'all' | 'waiting' | 'organizer' | 'guest';
const FILTERS: [Filter, string, (c: Conv) => boolean][] = [
  ['all', 'Все', () => true],
  ['waiting', 'Ждут вас', (c) => !!c.attention],
  ['organizer', 'Организаторы', (c) => c.kind === 'organizer'],
  ['guest', 'Гости', (c) => c.kind === 'guest'],
];

export default function Admin() {
  const [feed, setFeed] = useState<Wire<InboxFeed> | null>(null);
  const [problem, setProblem] = useState<string | null>(null); // код ошибки загрузки
  const [notice, setNotice] = useState('');
  // Два вида: «Люди» — список собеседников и переписка с выбранным; «Лента» — все сообщения подряд.
  const [view, setView] = useState<'people' | 'feed' | 'hosts' | 'agents' | 'events'>('people');
  const moderation = useModeration();
  const [agentFilter, setAgentFilter] = useState<AgentKey | 'all'>('all');
  const [overview, setOverview] = useState<Wire<AdminOverview> | null>(null); // разделы «Организаторы» и «Агенты»
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(''); // ключ выбранной строки: c:<диалог> или m:<сообщение>
  const [thread, setThread] = useState<Msg[]>([]); // вся переписка выбранного диалога
  const [drawer, setDrawer] = useState(false); // в «Ленте» переписка выезжает сбоку
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

  const all = feed?.conversations ?? [];
  const byId = new Map(all.map((c) => [c.id, c]));
  const labels = new Map(feed?.accounts.map((a) => [a.id, a.label]));
  // Через что идёт диалог: бот или наш аккаунт.
  const via = (c: Conv) => (c.channel === 'bot' ? 'боту' : `аккаунт «${labels.get(c.account_id ?? '') ?? 'не подключён'}»`);
  const pinned = all.filter((c) => c.attention);
  // Черновики агента в ленту не идут: они ждут решения.
  const drafts = new Map((feed?.messages ?? []).filter((m) => m.status === 'draft').map((m) => [m.conversation_id, m]));
  const events = (feed?.messages ?? []).flatMap((m) => {
    const c = byId.get(m.conversation_id);
    return c && m.status !== 'draft' ? [{ c, m }] : [];
  });
  const last = new Map<string, Msg>(); // последнее сообщение каждого диалога — для строки в списке
  for (const { c, m } of events) if (!last.has(c.id)) last.set(c.id, m);
  const needle = query.trim().toLowerCase().replace(/^@/, '');
  const people = all
    .filter(FILTERS.find(([key]) => key === filter)![2])
    .filter((c) => agentFilter === 'all' || c.agent === agentFilter)
    .filter((c) => !needle || c.peer_name.toLowerCase().includes(needle) || c.peer_username?.toLowerCase().includes(needle));

  const rows = view === 'people'
    ? people.map((c) => ({ key: `c:${c.id}`, c }))
    : view !== 'feed' ? []
    : [...pinned.map((c) => ({ key: `c:${c.id}`, c })), ...events.map(({ c, m }) => ({ key: `m:${m.id}`, c }))];
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
  const toggleMode = (c: Conv) => act(api.inboxUpdate(c.id, { mode: c.mode === 'agent' ? 'human' : 'agent', attention: null }));
  const done = (c: Conv) => act(api.inboxUpdate(c.id, { attention: null }));

  // Переписка следует за выбранным диалогом и обновляется вместе с лентой.
  const open = view === 'people' || drawer;
  useEffect(() => {
    if (!open || !curId) {
      setThread([]);
      return;
    }
    let stale = false;
    void api.inboxThread(curId).then((messages) => !stale && setThread(messages), () => {});
    return () => { stale = true; };
  }, [open, curId, newest]);
  // Разделы «Организаторы» и «Агенты» загружаются, когда открыты, и обновляются вместе с лентой.
  const sections = view === 'hosts' || view === 'agents';
  useEffect(() => {
    if (sections) void api.overview().then(setOverview, () => {});
  }, [sections, newest]);
  const openDialog = (id: string) => {
    setFilter('all');
    setAgentFilter('all');
    setQuery('');
    setSelected(`c:${id}`);
    setView('people');
  };

  // Новое сообщение в открытой переписке — прокручиваем к нему.
  useEffect(() => { root.current?.querySelector('.ad-thread')?.scrollTo({ top: 1e9 }); }, [thread.length, curId]);

  useEffect(() => {
    // Куда ставить курсор: в «Людях» — в правую панель, в «Ленте» — в выбранную строку.
    const focus = (selector: string) => root.current?.querySelector<HTMLElement>(`${view === 'people' ? '.ad-pane' : '.sel'} ${selector}`)?.focus();
    const draft = cur && drafts.get(cur.c.id);
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest('input, textarea');
      if (e.key === 'Escape') return typing ? (typing as HTMLElement).blur() : setDrawer(false);
      // В черновике Enter — перенос строки, отправка — Cmd/Ctrl+Enter.
      if (typing?.tagName === 'TEXTAREA' && draft && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) return void act(api.draftSend(draft.id, edited[draft.id]));
      if (typing || !cur || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (e.key === 'ArrowDown' || key === 'j') setSelected(rows[Math.min(at + 1, rows.length - 1)]!.key);
      else if (e.key === 'ArrowUp' || key === 'k') setSelected(rows[Math.max(at - 1, 0)]!.key);
      else if (e.key === 'Enter' && draft) void act(api.draftSend(draft.id, edited[draft.id]));
      else if ((key === 'x' || key === 'ч') && draft) void act(api.draftReject(draft.id));
      else if ((key === 'e' || key === 'у') && draft) focus('textarea');
      else if (e.key === 'Enter' || key === 'r' || key === 'к') focus('input');
      else if (key === 't' || key === 'е') void toggleMode(cur.c);
      else if (key === 'd' || key === 'в') void done(cur.c);
      else if ((key === 'o' || key === 'щ') && view === 'feed') setDrawer(!drawer);
      else if (e.key === '/') root.current?.querySelector<HTMLElement>('.ad-search')?.focus();
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });
  useEffect(() => { root.current?.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }); }, [at, view]);

  if (!feed) {
    return (
      <div className="ad-gate">
        {problem === 'unauthorized' && <a className="ad-btn" href={loginUrl('/admin')}>Войти через Telegram</a>}
        {problem === 'forbidden' && <p>У этого аккаунта нет доступа к админке.</p>}
        {problem && problem !== 'unauthorized' && problem !== 'forbidden' && <p>Не получилось загрузить переписку. Повторяю…</p>}
      </div>
    );
  }

  const pendingEvents = moderation.items?.filter((e) => e.status === 'pending').length ?? 0;

  // Черновик агента: причина, правка текста, отправить или отклонить.
  const draftBlock = (draft: Msg) => (
    <div className="ad-draft">
      <div className="ad-hint warn">
        Агент предлагает {draft.meta?.reply_to ? 'ответить в чате' : 'написать'}. {draft.meta?.reason}
        {draft.meta?.source_url && <> · <a href={draft.meta.source_url} target="_blank" rel="noreferrer">открыть сообщение</a></>}
      </div>
      <textarea rows={3} value={edited[draft.id] ?? draft.text} onChange={(e) => setEdited({ ...edited, [draft.id]: e.target.value })} />
      <div className="ad-inline">
        <button className="ad-btn" onClick={() => void act(api.draftSend(draft.id, edited[draft.id]))}>Отправить</button>
        <button className="ad-btn ghost" onClick={() => void act(api.draftReject(draft.id))}>Отклонить</button>
      </div>
    </div>
  );
  const bubbles = (c: Conv) => thread.filter((m) => m.status !== 'draft').map((m) => (
    <div key={m.id} className={`ad-msg ${kind(m)}`}>
      <div className="ad-bubble">{m.text}</div>
      <div className="ad-hint">{who(c, m, feed.me, via(c))} · {STATUS_TEXT(m)}</div>
    </div>
  ));
  const person = (c: Conv) => `${c.kind === 'organizer' ? 'Организатор' : 'Гость'} · ${INBOX_STAGES[c.stage]}`;

  return (
    <div className="ad" ref={root}>
      <header className="ad-strip">
        <h1>Я с вами</h1>
        <span className="ad-tabs">
          <button className={view === 'people' ? 'on' : ''} onClick={() => setView('people')}>Люди</button>
          <button className={view === 'feed' ? 'on' : ''} onClick={() => setView('feed')}>Лента</button>
          <button className={view === 'hosts' ? 'on' : ''} onClick={() => setView('hosts')}>Организаторы</button>
          <button className={view === 'agents' ? 'on' : ''} onClick={() => setView('agents')}>Агенты</button>
          <button className={view === 'events' ? 'on' : ''} onClick={() => setView('events')}>
            События{pendingEvents > 0 && <b className="ad-badge">{pendingEvents}</b>}
          </button>
        </span>
        <span className="ad-pill">Ждут вас: {pinned.length}</span>
        <button className="ad-btn ghost" onClick={() => setShowAccounts(!showAccounts)}>Аккаунты: {feed.accounts.filter((a) => a.status === 'active').length}</button>
        <i />
        {(notice || problem) && <span className="ad-pill warn">{notice || 'Нет связи с сервером'}</span>}
        <span className="ad-hint">↑↓ выбрать · Enter ответить или отправить черновик · E править · X отклонить · T взять / вернуть боту · D готово{view === 'feed' ? ' · O переписка' : ''}</span>
      </header>
      {showAccounts && <div className="ad-over"><Accounts accounts={feed.accounts} act={act} /></div>}

      {view === 'people' && (
        <div className="ad-people">
          <aside className="ad-list">
            <input className="ad-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск по имени или @username" />
            <div className="ad-chips">
              {FILTERS.map(([key, label, match]) => (
                <button key={key} className={filter === key ? 'on' : ''} onClick={() => setFilter(key)}>{label} {all.filter(match).length}</button>
              ))}
            </div>
            <div className="ad-chips">
              <span className="ad-hint">Агент:</span>
              <button className={agentFilter === 'all' ? 'on' : ''} onClick={() => setAgentFilter('all')}>любой</button>
              {(Object.keys(AGENTS) as AgentKey[]).map((key) => (
                <button key={key} className={agentFilter === key ? 'on' : ''} onClick={() => setAgentFilter(key)}>{AGENTS[key].name} {all.filter((c) => c.agent === key).length}</button>
              ))}
            </div>
            {people.length === 0 && <p className="ad-hint">Никого нет.</p>}
            {people.map((c) => (
              <div key={c.id} className={`ad-person ${cur?.c.id === c.id ? 'sel' : ''}`} onClick={() => setSelected(`c:${c.id}`)}>
                <div className="ad-row"><strong>{c.peer_name}</strong><span className="ad-time">{time(c.last_message_at)}</span></div>
                <div className="ad-hint ad-clip">{last.get(c.id)?.direction === 'out' && 'Мы: '}{last.get(c.id)?.text ?? drafts.get(c.id)?.text}</div>
                <div className="ad-row">
                  <span className="ad-hint">{person(c)}</span>
                  <span className="ad-tags">
                    {drafts.has(c.id) && <b className="ad-tag warn">черновик</b>}
                    {c.attention && !drafts.has(c.id) && <b className="ad-tag bad">ждёт вас</b>}
                  </span>
                </div>
                <div className="ad-hint">{leads(c)}</div>
              </div>
            ))}
          </aside>
          <section className="ad-pane">
            {!cur && <p className="ad-hint ad-empty">Выберите человека слева.</p>}
            {cur && (
              <>
                <header className="ad-row">
                  <span>
                    <strong>{cur.c.peer_name}</strong>{' '}
                    {cur.c.peer_username && <a className="ad-hint" href={`https://t.me/${cur.c.peer_username}`} target="_blank" rel="noreferrer">@{cur.c.peer_username}</a>}
                    <div className="ad-hint">{person(cur.c)} · пишет {via(cur.c)} · {leads(cur.c)}</div>
                    {cur.c.attention && <div className="ad-hint warn">Ждёт вас: {cur.c.attention}</div>}
                  </span>
                  <span className="ad-inline">
                    {cur.c.attention && <button className="ad-btn ghost" onClick={() => void done(cur.c)}>Готово</button>}
                    <button className="ad-btn ghost" onClick={() => void toggleMode(cur.c)}>{cur.c.mode === 'agent' ? 'Взять на себя' : 'Вернуть агенту'}</button>
                  </span>
                </header>
                <div className="ad-thread">{bubbles(cur.c)}</div>
                {drafts.has(cur.c.id) && draftBlock(drafts.get(cur.c.id)!)}
                <Reply onSend={send(cur.c)} />
              </>
            )}
          </section>
        </div>
      )}

      {view === 'hosts' && (
        <main>
          <div className="ad-wide">
            <h2>Организаторы <b className="ad-badge">{overview?.hosts.length ?? 0}</b></h2>
            <p className="ad-hint">Профили собраны по открытым анонсам. «Записей» — сколько раз на предстоящие события организатора нажали «Записаться» у нас.</p>
            {!overview && <p className="ad-hint">Загружаю…</p>}
            {overview && (
              <table className="ad-table">
                <thead><tr><th>Организатор</th><th>О нём</th><th>Событий</th><th>Записей</th><th>В сервисе</th><th>Переписка</th></tr></thead>
                <tbody>
                  {[...overview.hosts].sort((a, b) => b.signups - a.signups || b.events - a.events).map((h) => (
                    <tr key={h.telegram_id}>
                      <td>
                        <strong>{h.name}</strong>
                        <div><a href={`https://t.me/${h.username}`} target="_blank" rel="noreferrer">@{h.username}</a></div>
                        {h.channel && <div className="ad-hint">канал <a href={`https://t.me/${h.channel}`} target="_blank" rel="noreferrer">@{h.channel}</a></div>}
                      </td>
                      <td className="ad-hint">{h.summary ?? '—'}</td>
                      <td>{h.events}</td>
                      <td>{h.signups}</td>
                      <td>{h.registered ? <b className="ad-tag ok">вошёл</b> : <span className="ad-hint">нет</span>}</td>
                      <td>
                        {h.conversation_id
                          ? <button className="ad-link" onClick={() => openDialog(h.conversation_id!)}>{INBOX_STAGES[h.stage!]}</button>
                          : <span className="ad-hint">не писали</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </main>
      )}

      {view === 'events' && <Events items={moderation.items} act={act} reload={moderation.reload} />}

      {view === 'agents' && (
        <main>
          <div className="ad-wide">
            <h2>Агенты</h2>
            <p className="ad-hint">Кто что делает и кому пишет. Агенты не отправляют сообщений первыми без вас: исключение — поддержка, она отвечает тем, кто сам написал боту.</p>
            {!overview && <p className="ad-hint">Загружаю…</p>}
            <div className="ad-cards">
              {overview?.agents.map((a) => (
                <div key={a.key} className="ad-card">
                  <div className="ad-row">
                    <strong>{AGENTS[a.key].name}</strong>
                    <b className={`ad-tag ${a.enabled ? 'ok' : ''}`}>{a.enabled ? 'включён' : 'выключен'}</b>
                  </div>
                  <div>{AGENTS[a.key].about}</div>
                  <div className="ad-hint">Когда отправляет: {AGENTS[a.key].sends}</div>
                  <div className="ad-stats">
                    <span><b>{a.conversations}</b> диалогов</span>
                    <span><b>{a.drafts}</b> черновиков ждут</span>
                    <span><b>{a.sent_today}</b> отправлено за сутки</span>
                    <span><b>{a.sent}</b> всего</span>
                  </div>
                  <button className="ad-link" onClick={() => { setFilter('all'); setQuery(''); setAgentFilter(a.key); setView('people'); }}>Показать его диалоги</button>
                </div>
              ))}
            </div>
          </div>
        </main>
      )}

      {view === 'feed' && (
        <main>
          <div className="ad-col">
            <h2>Ждут вас <b className="ad-badge">{pinned.length}</b></h2>
            {pinned.length === 0 && <p className="ad-hint">Никто не ждёт. Ниже видно всё, что происходит.</p>}
            {pinned.map((c) => (
              <div key={c.id} className={`ad-pin ${cur?.key === `c:${c.id}` ? 'sel' : ''}`} onClick={() => setSelected(`c:${c.id}`)}>
                <div className="ad-row">
                  <span>
                    <strong>{c.peer_name}</strong> {c.peer_username && <span className="ad-hint">@{c.peer_username}</span>}{' '}
                    <span className="ad-hint">{person(c)}</span>{' '}
                    {c.mode === 'human' && <b className="ad-tag">ведёте вы</b>}
                  </span>
                  <b className="ad-tag bad">{c.attention}</b>
                </div>
                {feed.messages.filter((m) => m.conversation_id === c.id && m.direction === 'in').slice(0, 2).reverse().map((m) => (
                  <div key={m.id} className="ad-quote">{m.text}</div>
                ))}
                {drafts.has(c.id) ? draftBlock(drafts.get(c.id)!) : <Reply onSend={send(c)} />}
              </div>
            ))}

            <h2>Лента <span className="ad-live">идёт</span></h2>
            {events.length === 0 && <p className="ad-hint">Пока никто не писал.</p>}
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
      )}
      {view === 'feed' && drawer && cur && (
        <aside className="ad-drawer">
          <header className="ad-row">
            <span>
              <strong>{cur.c.peer_name}</strong> {cur.c.peer_username && <span className="ad-hint">@{cur.c.peer_username}</span>}
              <div className="ad-hint">{person(cur.c)} · {cur.c.mode === 'human' ? 'диалог ведёте вы' : 'отвечает агент'}</div>
            </span>
            <button className="ad-btn ghost" onClick={() => setDrawer(false)}>Закрыть</button>
          </header>
          <div className="ad-thread">{bubbles(cur.c)}</div>
          <Reply onSend={send(cur.c)} />
        </aside>
      )}
    </div>
  );
}
