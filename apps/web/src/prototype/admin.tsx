// ПРОТОТИП, не продакшен. Три варианта админки переписки (docs/agents-inbox.md), переключаются ?variant=A|B|C|D.
// Запуск: pnpm dev:web → http://localhost:5173/prototype-admin.html. Данные выдуманы и живут в памяти.
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../tokens.css';
import './admin.css';

type Role = 'support' | 'host' | 'hunter';
type Message = { dir: 'in' | 'out'; author: 'user' | 'agent' | 'admin'; text: string; time: string; status?: 'draft' | 'sent'; reason?: string; seq?: number };
type Dialog = {
  id: number;
  name: string;
  username: string;
  via: string; // бот или аккаунт, с которого идёт переписка
  role: Role;
  mode: 'agent' | 'human';
  stage: 'Новый' | 'В разговоре' | 'Зарегистрировался';
  unread: number;
  needsHuman?: boolean;
  why?: string; // почему диалог ждёт нас
  messages: Message[];
};

const ROLE: Record<Role, string> = { support: 'Поддержка', host: 'Организаторы', hunter: 'Охотник' };

const DIALOGS: Dialog[] = [
  {
    id: 1, name: 'Марина', username: 'marina_yoga', via: 'Аккаунт «Аня»', role: 'host', mode: 'agent', stage: 'Новый', unread: 0,
    messages: [
      { dir: 'out', author: 'agent', status: 'draft', time: '12:40', reason: 'На «Йогу на рассвете» в субботу через нас записались 4 человека',
        text: 'Марина, привет! Это Аня из «Я с вами» — мы собираем события Дананга в одном месте. На вашу йогу в субботу через нас записались 4 человека. Прислать список? Заодно могу подключить вам страницу, где видно всех гостей.' },
    ],
  },
  {
    id: 2, name: 'Олег', username: 'oleg_dn', via: 'Бот', role: 'support', mode: 'agent', stage: 'В разговоре', unread: 2, needsHuman: true, why: 'Просит человека',
    messages: [
      { dir: 'in', author: 'user', text: 'Записался на покер в пятницу, а организатор говорит, что мест нет', time: '12:21' },
      { dir: 'out', author: 'agent', status: 'sent', text: 'Вижу вашу запись на «Покер в пятницу». Места подтверждает сам организатор — уточню у него и вернусь.', time: '12:21' },
      { dir: 'in', author: 'user', text: 'Можно с человеком поговорить?', time: '12:30' },
      { dir: 'in', author: 'user', text: 'Я уже друзей позвал', time: '12:31' },
    ],
  },
  {
    id: 3, name: 'Tim', username: 'tim_poker', via: 'Аккаунт «Аня»', role: 'host', mode: 'agent', stage: 'В разговоре', unread: 1,
    messages: [
      { dir: 'out', author: 'agent', status: 'sent', text: 'Тим, привет! На «Покер в пятницу» через «Я с вами» записались 6 человек. Прислать список?', time: 'вчера' },
      { dir: 'in', author: 'user', text: 'О, давай. А что это за сервис?', time: '11:02' },
      { dir: 'out', author: 'agent', status: 'sent', text: 'Каталог событий Дананга в Telegram: люди записываются в один тап, вы видите гостей. Вот ваши шесть: Олег, Даша, Никита, Аля, Макс, Ира. Чтобы видеть записи сразу — войдите по ссылке, это минута.', time: '11:03' },
      { dir: 'in', author: 'user', text: 'Это платно?', time: '11:40' },
    ],
  },
  {
    id: 4, name: 'Даша', username: 'dasha_k', via: 'Аккаунт «Макс»', role: 'hunter', mode: 'agent', stage: 'Новый', unread: 0,
    messages: [
      { dir: 'in', author: 'user', text: '[чат «Дананг · афиша»] Ребят, куда сегодня вечером можно сходить потанцевать?', time: '12:05' },
      { dir: 'out', author: 'agent', status: 'draft', time: '12:06', reason: 'Вопрос в чате «Дананг · афиша», подходит Ecstatic dance сегодня в 19:00',
        text: 'Сегодня в 19:00 Ecstatic dance на Ми Кхе, вход свободный, записаться можно тут: t.me/yaswami_bot?startapp=ed-19' },
    ],
  },
  {
    id: 5, name: 'Никита', username: 'nik_nomad', via: 'Бот', role: 'support', mode: 'agent', stage: 'В разговоре', unread: 0,
    messages: [
      { dir: 'in', author: 'user', text: 'Как отменить запись?', time: '10:15' },
      { dir: 'out', author: 'agent', status: 'sent', text: 'Откройте событие в приложении и нажмите «Не пойду» — организатор увидит это сразу.', time: '10:15' },
      { dir: 'in', author: 'user', text: 'Спасибо!', time: '10:16' },
    ],
  },
  {
    id: 6, name: 'Лена', username: 'lena_banya', via: 'Аккаунт «Аня»', role: 'host', mode: 'human', stage: 'Зарегистрировался', unread: 0,
    messages: [
      { dir: 'out', author: 'agent', status: 'sent', text: 'Лена, привет! На банный день в воскресенье через нас записались 3 человека.', time: 'пн' },
      { dir: 'in', author: 'user', text: 'Класс. А можно поставить лимит мест?', time: 'пн' },
      { dir: 'out', author: 'admin', status: 'sent', text: 'Лена, это Рашид, основатель. Да — лимит ставится в событии, я уже выставил 12 мест. Если что, пишите мне сюда.', time: 'пн' },
      { dir: 'in', author: 'user', text: 'Супер, зарегистрировалась', time: 'пн' },
    ],
  },
];

const ACCOUNTS = [
  { label: 'Аня', phone: '+84 ••• ••• 12', purpose: 'Пишет', status: 'Работает', sent: 9, limit: 15 },
  { label: 'Макс', phone: '+84 ••• ••• 47', purpose: 'Пишет', status: 'Пауза от Telegram до 14:10', sent: 15, limit: 15 },
  { label: 'Сборщик', phone: '+995 ••• ••• 03', purpose: 'Только читает', status: 'Работает', sent: 0, limit: 0 },
];

const ROLES: { key: Role; about: string; skills: string[]; enabled: boolean; approval: boolean }[] = [
  { key: 'support', about: 'Отвечает тем, кто написал боту', skills: ['Помочь записаться', 'Найти событие', 'Позвать человека'], enabled: true, approval: false },
  { key: 'host', about: 'Пишет организаторам, к которым пришли гости', skills: ['Первое сообщение с цифрами', 'Ответы на возражения', 'Вход в сервис'], enabled: true, approval: true },
  { key: 'hunter', about: 'Отвечает на «куда сходить» в чатах', skills: ['Подобрать событие', 'Короткий ответ в чат'], enabled: false, approval: true },
];

// Новые сообщения получают номер по порядку: по нему лента знает, что свежее.
let seq = 0;
const now = () => ({ time: 'сейчас', seq: ++seq });

function useStore() {
  const [dialogs, setDialogs] = useState(DIALOGS);
  const patch = (id: number, fn: (d: Dialog) => Dialog) => setDialogs((ds) => ds.map((d) => (d.id === id ? fn(d) : d)));
  const noDraft = (d: Dialog) => d.messages.filter((m) => m.status !== 'draft');
  return {
    dialogs,
    send: (id: number, text: string) =>
      patch(id, (d) => ({ ...d, mode: 'human', unread: 0, needsHuman: false, messages: [...noDraft(d), { dir: 'out', author: 'admin', text, status: 'sent', ...now() }] })),
    approve: (id: number, text?: string) =>
      patch(id, (d) => ({ ...d, stage: 'В разговоре', messages: d.messages.map((m) => (m.status === 'draft' ? { ...m, text: text ?? m.text, status: 'sent', ...now() } : m)) })),
    reject: (id: number) => patch(id, (d) => ({ ...d, messages: noDraft(d) })),
    push: (id: number, m: Omit<Message, 'time'>, extra: Partial<Dialog> = {}) => patch(id, (d) => ({ ...d, ...extra, messages: [...d.messages, { ...m, ...now() }] })),
    toggle: (id: number) => patch(id, (d) => ({ ...d, mode: d.mode === 'agent' ? 'human' : 'agent', needsHuman: false })),
  };
}
type Store = ReturnType<typeof useStore>;

const draftOf = (d: Dialog) => d.messages.find((m) => m.status === 'draft');
const lastOf = (d: Dialog) => d.messages[d.messages.length - 1]!;
const waiting = (d: Dialog) => !!draftOf(d) || !!d.needsHuman;

function Badges({ d }: { d: Dialog }) {
  return (
    <span className="pa-badges">
      {draftOf(d) && <b className="pa-badge warn">ждёт «отправить»</b>}
      {d.needsHuman && <b className="pa-badge bad">просит человека</b>}
      {d.mode === 'human' && <b className="pa-badge">ведёте вы</b>}
      {d.unread > 0 && <b className="pa-badge dot">{d.unread}</b>}
    </span>
  );
}

function Thread({ d, store, messages = d.messages }: { d: Dialog; store: Store; messages?: Message[] }) {
  return (
    <div className="pa-thread">
      {messages.map((m, i) => (
        <div key={i} className={`pa-msg ${m.dir} ${m.author} ${m.status ?? ''}`}>
          {m.reason && <div className="pa-reason">Почему: {m.reason}</div>}
          <div className="pa-bubble">{m.text}</div>
          <div className="pa-meta">
            {m.author === 'user' ? d.name : m.author === 'admin' ? 'Вы' : `Агент · ${ROLE[d.role]}`} · {m.status === 'draft' ? 'черновик, не отправлено' : m.time}
          </div>
          {m.status === 'draft' && (
            <div className="pa-actions">
              <button className="pa-btn" onClick={() => store.approve(d.id)}>Отправить</button>
              <button className="pa-btn ghost" onClick={() => store.reject(d.id)}>Отклонить</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Composer({ d, store }: { d: Dialog; store: Store }) {
  const [text, setText] = useState('');
  return (
    <form
      className="pa-composer"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) store.send(d.id, text.trim());
        setText('');
      }}
    >
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder={d.mode === 'agent' ? 'Написать самому — агент замолчит в этом диалоге' : 'Сообщение'} />
      <button className="pa-btn">Отправить</button>
    </form>
  );
}

function ChatHead({ d, store }: { d: Dialog; store: Store }) {
  return (
    <header className="pa-chathead">
      <div>
        <strong>{d.name}</strong> <span className="pa-hint">@{d.username}</span>
        <div className="pa-hint">{d.via} · {ROLE[d.role]} · {d.stage}</div>
      </div>
      <button className={`pa-btn ${d.mode === 'agent' ? 'ghost' : ''}`} onClick={() => store.toggle(d.id)}>
        {d.mode === 'agent' ? 'Взять на себя' : 'Вернуть агенту'}
      </button>
    </header>
  );
}

function AccountBar({ a }: { a: (typeof ACCOUNTS)[number] }) {
  return (
    <div className="pa-acc">
      <div className="pa-row"><strong>{a.label}</strong><span className="pa-hint">{a.limit ? `${a.sent} из ${a.limit} сегодня` : a.purpose}</span></div>
      {a.limit > 0 && <div className="pa-bar"><i style={{ width: `${(a.sent / a.limit) * 100}%` }} className={a.sent >= a.limit ? 'full' : ''} /></div>}
      <div className={`pa-hint ${a.status === 'Работает' ? '' : 'warn'}`}>{a.status}</div>
    </div>
  );
}

function Switch({ on, label }: { on: boolean; label: string }) {
  const [v, setV] = useState(on);
  return (
    <label className="pa-switch">
      <input type="checkbox" checked={v} onChange={() => setV(!v)} /> {label}
    </label>
  );
}

// ───── Вариант A: «Мессенджер» — три колонки, как привычный чат поддержки ─────
function VariantA({ store }: { store: Store }) {
  const [tab, setTab] = useState<'dialogs' | 'accounts' | 'roles'>('dialogs');
  const [id, setId] = useState(2);
  const [step, setStep] = useState(0); // шаги добавления аккаунта
  const d = store.dialogs.find((x) => x.id === id)!;
  const nav = [
    ['dialogs', 'Диалоги', store.dialogs.filter(waiting).length],
    ['accounts', 'Аккаунты', 0],
    ['roles', 'Роли', 0],
  ] as const;
  return (
    <div className="pa-a">
      <nav className="pa-rail">
        <h1>Я с вами</h1>
        {nav.map(([key, label, n]) => (
          <button key={key} className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>
            {label} {n > 0 && <b className="pa-badge dot">{n}</b>}
          </button>
        ))}
      </nav>
      {tab === 'dialogs' && (
        <>
          <ul className="pa-list">
            {store.dialogs.map((x) => (
              <li key={x.id} className={x.id === id ? 'on' : ''} onClick={() => setId(x.id)}>
                <div className="pa-row"><strong>{x.name}</strong><span className="pa-hint">{lastOf(x).time}</span></div>
                <div className="pa-hint pa-clip">{lastOf(x).author === 'user' ? '' : lastOf(x).author === 'admin' ? 'Вы: ' : 'Агент: '}{lastOf(x).text}</div>
                <div className="pa-row"><span className="pa-hint">{ROLE[x.role]} · {x.via}</span><Badges d={x} /></div>
              </li>
            ))}
          </ul>
          <section className="pa-chat">
            <ChatHead d={d} store={store} />
            <Thread d={d} store={store} />
            <Composer d={d} store={store} />
          </section>
        </>
      )}
      {tab === 'accounts' && (
        <section className="pa-page">
          <div className="pa-row"><h2>Аккаунты Telegram</h2><button className="pa-btn" onClick={() => setStep(1)}>Добавить аккаунт</button></div>
          {step > 0 && (
            <div className="pa-card pa-stepper">
              <strong>{['', 'Шаг 1 из 3 · номер телефона', 'Шаг 2 из 3 · код из Telegram', 'Шаг 3 из 3 · пароль двухэтапной проверки', 'Аккаунт добавлен'][step]}</strong>
              {step < 4 && <input placeholder={['', '+84 …', '5 цифр', 'пароль'][step]} type={step === 3 ? 'password' : 'text'} />}
              <button className="pa-btn" onClick={() => setStep(step === 4 ? 0 : step + 1)}>{step === 4 ? 'Готово' : 'Дальше'}</button>
            </div>
          )}
          <table className="pa-table">
            <thead><tr><th>Аккаунт</th><th>Номер</th><th>Задача</th><th>Сегодня</th><th>Состояние</th></tr></thead>
            <tbody>
              {ACCOUNTS.map((a) => (
                <tr key={a.label}><td><strong>{a.label}</strong></td><td>{a.phone}</td><td>{a.purpose}</td><td>{a.limit ? `${a.sent} из ${a.limit}` : '—'}</td><td className={a.status === 'Работает' ? '' : 'warn'}>{a.status}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {tab === 'roles' && (
        <section className="pa-page">
          <h2>Роли агентов</h2>
          <div className="pa-grid">
            {ROLES.map((r) => (
              <div key={r.key} className="pa-card">
                <strong>{ROLE[r.key]}</strong>
                <div className="pa-hint">{r.about}</div>
                <div className="pa-chips">{r.skills.map((s) => <span key={s}>{s}</span>)}</div>
                <div className="pa-hint">Ведёт диалогов: {store.dialogs.filter((x) => x.role === r.key && x.mode === 'agent').length}</div>
                <Switch on={r.enabled} label="Включена" />
                <Switch on={r.approval} label="Каждое первое сообщение утверждаю я" />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ───── Вариант B: «Очередь» — на экране только то, что ждёт вашего решения, по одному ─────
function VariantB({ store }: { store: Store }) {
  const queue = store.dialogs.filter(waiting);
  const calm = store.dialogs.filter((x) => !waiting(x));
  const [pick, setPick] = useState<number | null>(null);
  const d = queue.find((x) => x.id === pick) ?? queue[0];
  const draft = d && draftOf(d);
  const [edited, setEdited] = useState<Record<number, string>>({});
  return (
    <div className="pa-b">
      <aside className="pa-queue">
        <h2>Ждут вас <b className="pa-badge dot">{queue.length}</b></h2>
        {queue.map((x) => (
          <button key={x.id} className={x.id === d?.id ? 'on' : ''} onClick={() => setPick(x.id)}>
            <strong>{x.name}</strong>
            <span className="pa-hint">{draftOf(x) ? `${ROLE[x.role]} хочет написать` : 'Просит человека'}</span>
          </button>
        ))}
        <h2>Идут сами</h2>
        {calm.map((x) => (
          <div key={x.id} className="pa-calm">
            <strong>{x.name}</strong> <span className="pa-hint">{x.mode === 'human' ? 'ведёте вы' : ROLE[x.role]} · {x.stage}</span>
          </div>
        ))}
      </aside>
      <main className="pa-focus">
        {!d && <div className="pa-empty"><h2>Всё разобрано</h2><p className="pa-hint">Агенты работают, новых вопросов к вам нет.</p></div>}
        {d && (
          <div className="pa-card pa-decision">
            <div className="pa-hint">{d.via} · {ROLE[d.role]}</div>
            <h2>{draft ? `${d.name}: отправить сообщение?` : `${d.name} просит человека`}</h2>
            {draft?.reason && <p className="pa-reason">Почему: {draft.reason}</p>}
            {d.messages.some((m) => m.status !== 'draft') && <Thread d={d} store={store} messages={d.messages.filter((m) => m.status !== 'draft').slice(-3)} />}
            {draft ? (
              <>
                <textarea rows={5} value={edited[d.id] ?? draft.text} onChange={(e) => setEdited({ ...edited, [d.id]: e.target.value })} />
                <div className="pa-actions">
                  <button className="pa-btn" onClick={() => store.approve(d.id, edited[d.id])}>Отправить</button>
                  <button className="pa-btn ghost" onClick={() => store.reject(d.id)}>Не отправлять</button>
                  <button className="pa-btn ghost" onClick={() => store.toggle(d.id)}>Напишу сам</button>
                </div>
              </>
            ) : (
              <Composer d={d} store={store} />
            )}
          </div>
        )}
      </main>
      <aside className="pa-side">
        <h2>Аккаунты</h2>
        {ACCOUNTS.map((a) => <AccountBar key={a.label} a={a} />)}
        <button className="pa-btn ghost">Добавить аккаунт</button>
        <h2>Роли</h2>
        {ROLES.map((r) => <Switch key={r.key} on={r.enabled} label={`${ROLE[r.key]}${r.approval ? ' · с утверждением' : ''}`} />)}
      </aside>
    </div>
  );
}

// ───── Вариант C: «Пульт» — воронка колонками, состояние системы сверху, чат выезжает сбоку ─────
function VariantC({ store }: { store: Store }) {
  const [id, setId] = useState<number | null>(null);
  const d = store.dialogs.find((x) => x.id === id);
  const stages = ['Новый', 'В разговоре', 'Зарегистрировался'] as const;
  return (
    <div className="pa-c">
      <header className="pa-strip">
        <h1>Я с вами</h1>
        {ROLES.map((r) => (
          <span key={r.key} className={`pa-pill ${r.enabled ? 'ok' : ''}`}>{ROLE[r.key]}: {r.enabled ? `ведёт ${store.dialogs.filter((x) => x.role === r.key && x.mode === 'agent').length}` : 'выключена'}</span>
        ))}
        <i />
        {ACCOUNTS.filter((a) => a.limit).map((a) => (
          <span key={a.label} className={`pa-pill ${a.sent >= a.limit ? 'warn' : 'ok'}`}>{a.label}: {a.sent}/{a.limit}</span>
        ))}
        <button className="pa-btn ghost">Аккаунты и роли</button>
      </header>
      <div className="pa-board">
        {stages.map((stage) => (
          <section key={stage}>
            <h2>{stage} <span className="pa-hint">{store.dialogs.filter((x) => x.stage === stage).length}</span></h2>
            {store.dialogs.filter((x) => x.stage === stage).map((x) => (
              <article key={x.id} className={`pa-card ${x.id === id ? 'on' : ''}`} onClick={() => setId(x.id)}>
                <div className="pa-row"><strong>{x.name}</strong><span className="pa-hint">{lastOf(x).time}</span></div>
                <div className="pa-hint pa-clip2">{lastOf(x).text}</div>
                <div className="pa-row"><span className="pa-hint">{ROLE[x.role]}</span><Badges d={x} /></div>
              </article>
            ))}
          </section>
        ))}
      </div>
      {d && (
        <aside className="pa-drawer pa-chat">
          <button className="pa-close" onClick={() => setId(null)} aria-label="Закрыть">×</button>
          <ChatHead d={d} store={store} />
          <Thread d={d} store={store} />
          <Composer d={d} store={store} />
        </aside>
      )}
    </div>
  );
}

// ───── Вариант D: «Лента» — живой поток всего, что происходит; сверху закреплено то, что ждёт вас; управление с клавиатуры ─────
const rank = (m: Message) => {
  if (m.seq) return 10_000 + m.seq;
  const hm = /^(\d+):(\d+)$/.exec(m.time);
  return hm ? Number(hm[1]) * 60 + Number(hm[2]) : m.time === 'вчера' ? -1 : -2;
};
const who = (d: Dialog, m: Message) =>
  m.author === 'user' ? `${d.name} → ${d.via === 'Бот' ? 'боту' : d.via}` : m.author === 'admin' ? `Вы → ${d.name}` : `${ROLE[d.role]} → ${d.name}`;

// Что «происходит» само, пока вы смотрите: [через сколько секунд, диалог, сообщение, что меняется в диалоге].
const SCRIPT: [number, number, Omit<Message, 'time'>, Partial<Dialog>?][] = [
  [5, 5, { dir: 'in', author: 'user', text: 'А есть что-нибудь на завтра утром?' }],
  [8, 5, { dir: 'out', author: 'agent', status: 'sent', text: 'Завтра в 6:30 йога на рассвете на Ми Кхе, осталось 5 мест. Записать вас?' }],
  [14, 3, { dir: 'in', author: 'user', text: 'И сколько это будет стоить потом?' }, { needsHuman: true, why: 'Агент не уверен: про цену в правилах роли ответа нет' }],
  [20, 5, { dir: 'in', author: 'user', text: 'Да, запишите' }],
  [22, 5, { dir: 'out', author: 'agent', status: 'sent', text: 'Готово, вы записаны на йогу завтра в 6:30. Напомню за час.' }],
];

function InlineReply({ d, store }: { d: Dialog; store: Store }) {
  const [text, setText] = useState('');
  return (
    <form
      className="pa-inline"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) store.send(d.id, text.trim());
        setText('');
        (document.activeElement as HTMLElement | null)?.blur();
      }}
    >
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ответить самому — Enter отправит, агент замолчит" />
    </form>
  );
}

function VariantD({ store }: { store: Store }) {
  const [filter, setFilter] = useState<Role | 'all'>('all');
  const [cursor, setCursor] = useState(0);
  const [open, setOpen] = useState(false); // вся переписка сбоку
  const [edited, setEdited] = useState<Record<number, string>>({});
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timers = SCRIPT.map(([sec, id, m, extra]) => setTimeout(() => store.push(id, m, extra), sec * 1000));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = store.dialogs.filter((d) => filter === 'all' || d.role === filter);
  const pinned = shown.filter(waiting);
  const feed = shown
    .flatMap((d) => d.messages.filter((m) => m.status !== 'draft').map((m) => ({ d, m })))
    .sort((x, y) => rank(y.m) - rank(x.m));
  const rows = [...pinned.map((d) => ({ d, m: undefined as Message | undefined })), ...feed];
  const at = Math.min(cursor, rows.length - 1);
  const cur = rows[at];

  useEffect(() => {
    const focus = (selector: string) => root.current?.querySelector<HTMLElement>(`.sel ${selector}`)?.focus();
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest('input, textarea');
      if (e.key === 'Escape') return typing ? (typing as HTMLElement).blur() : setOpen(false);
      if (typing) {
        // В черновике Enter — перенос строки, отправка — Cmd/Ctrl+Enter.
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && cur && draftOf(cur.d)) store.approve(cur.d.id, edited[cur.d.id]);
        return;
      }
      if (!cur || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (e.key === 'ArrowDown' || key === 'j') setCursor(Math.min(at + 1, rows.length - 1));
      else if (e.key === 'ArrowUp' || key === 'k') setCursor(Math.max(at - 1, 0));
      else if (e.key === 'Enter') {
        if (draftOf(cur.d) && !cur.m) store.approve(cur.d.id, edited[cur.d.id]);
        else focus('input');
      } else if (key === 'e' || key === 'у') focus('textarea');
      else if (key === 'r' || key === 'к') focus('input');
      else if (key === 't' || key === 'е') store.toggle(cur.d.id);
      else if (key === 'x' || key === 'ч') {
        if (draftOf(cur.d)) store.reject(cur.d.id);
      } else if (key === 'o' || key === 'щ') setOpen(!open);
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });
  useEffect(() => root.current?.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }), [at]);

  const count = (stage: Dialog['stage']) => store.dialogs.filter((d) => d.stage === stage).length;
  return (
    <div className="pa-d" ref={root}>
      <header className="pa-strip">
        <h1>Я с вами</h1>
        <span className="pa-pill">Новые {count('Новый')} → в разговоре {count('В разговоре')} → зарегистрировались {count('Зарегистрировался')}</span>
        <i />
        {ACCOUNTS.filter((a) => a.limit).map((a) => (
          <span key={a.label} className={`pa-pill ${a.sent >= a.limit ? 'warn' : 'ok'}`}>{a.label}: {a.sent}/{a.limit}</span>
        ))}
        <button className="pa-btn ghost">Аккаунты</button>
        <button className="pa-btn ghost">Роли</button>
      </header>
      <div className="pa-keys">
        <span>
          {(['all', 'support', 'host', 'hunter'] as const).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => { setFilter(f); setCursor(0); }}>{f === 'all' ? 'Все' : ROLE[f]}</button>
          ))}
        </span>
        <span className="pa-hint">↑↓ по ленте · Enter отправить · E править · X отклонить · R ответить · T взять / вернуть · O переписка · Esc</span>
      </div>
      <main>
        <div className="pa-col">
          <h2>Ждут вас <b className="pa-badge dot">{pinned.length}</b></h2>
          {pinned.length === 0 && <p className="pa-hint">Никто не ждёт. Агенты работают сами — ниже видно, что происходит.</p>}
          {pinned.map((d, i) => {
            const draft = draftOf(d);
            return (
              <div key={d.id} className={`pa-pin ${i === at ? 'sel' : ''}`} onClick={() => setCursor(i)}>
                <div className="pa-row">
                  <span><strong>{d.name}</strong> <span className="pa-hint">{ROLE[d.role]} · {d.via}</span></span>
                  <b className={`pa-badge ${draft ? 'warn' : 'bad'}`}>{draft ? 'ждёт «отправить»' : d.why}</b>
                </div>
                {draft ? (
                  <>
                    <p className="pa-reason">Почему: {draft.reason}</p>
                    <textarea rows={3} value={edited[d.id] ?? draft.text} onChange={(e) => setEdited({ ...edited, [d.id]: e.target.value })} />
                  </>
                ) : (
                  <>
                    {d.messages.filter((m) => m.author === 'user').slice(-2).map((m, k) => <div key={k} className="pa-quote">{m.text}</div>)}
                    <InlineReply d={d} store={store} />
                  </>
                )}
              </div>
            );
          })}
          <div className="pa-sys">Аккаунт «Макс» на паузе от Telegram до 14:10 — новые диалоги идут через «Аню».</div>

          <h2>Лента <span className="pa-live">идёт</span></h2>
          {feed.map(({ d, m }, i) => {
            const sel = pinned.length + i === at;
            return (
              <div key={`${d.id}-${rank(m)}-${i}`} className={`pa-ev ${m.author} ${sel ? 'sel' : ''} ${m.seq ? 'fresh' : ''}`} onClick={() => setCursor(pinned.length + i)}>
                <span className="pa-time">{m.time}</span>
                <div>
                  <div className="pa-who">{who(d, m)} {d.mode === 'human' && <b className="pa-badge">ведёте вы</b>}</div>
                  <div>{m.text}</div>
                  {sel && <InlineReply d={d} store={store} />}
                </div>
              </div>
            );
          })}
        </div>
      </main>
      {open && cur && (
        <aside className="pa-drawer pa-chat">
          <button className="pa-close" onClick={() => setOpen(false)} aria-label="Закрыть">×</button>
          <ChatHead d={cur.d} store={store} />
          <Thread d={cur.d} store={store} />
        </aside>
      )}
    </div>
  );
}

const VARIANTS = [
  ['A', 'Мессенджер', VariantA],
  ['B', 'Очередь решений', VariantB],
  ['C', 'Пульт-воронка', VariantC],
  ['D', 'Лента', VariantD],
] as const;

function Prototype() {
  const store = useStore();
  const [key, setKey] = useState(new URLSearchParams(location.search).get('variant') ?? 'A');
  const index = Math.max(0, VARIANTS.findIndex((v) => v[0] === key));
  const go = (step: number) => {
    const next = VARIANTS[(index + step + VARIANTS.length) % VARIANTS.length]![0];
    history.replaceState(null, '', `?variant=${next}`);
    setKey(next);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, [contenteditable]')) return;
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });
  const [, name, Variant] = VARIANTS[index]!;
  return (
    <>
      <Variant store={store} />
      <div className="pa-switcher">
        <button onClick={() => go(-1)} aria-label="Предыдущий вариант">←</button>
        <span>{VARIANTS[index]![0]} · {name}</span>
        <button onClick={() => go(1)} aria-label="Следующий вариант">→</button>
      </div>
    </>
  );
}

createRoot(document.getElementById('app')!).render(<Prototype />);
