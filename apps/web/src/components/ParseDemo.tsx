import type { DemoExample } from '../add.ts';
import { segments } from '../add.ts';
import type { DemoPhase, ParseDemoState } from '../hooks/useParseDemo.ts';

const STATUS = { parsing: 'раскладывает по полям', done: 'готово, проверьте' };

/**
 * Показ «человек пишет боту — бот понимает»: сообщение набирается, бот читает, куски текста подсвечиваются и встают
 * полями в карточку. Один на все места, где у нас нет формы: «Добавить» (событие, товар, услуга) и отзыв о мастере.
 * Состояние ведёт `useParseDemo`; компонент только рисует. Скринридеру сцена не читается — смысл есть в тексте рядом.
 */
export function ParseDemo({ example, phase, typed, revealed }: ParseDemoState) {
  const parts = segments(example.message, example.fields);
  const lit = (field: number | undefined) => field !== undefined && field < revealed;
  const open = phase === 'parsing' || phase === 'done';
  let left = typed; // сколько символов уже набрано: куски за этой границей не видны
  return (
    <div className="parse" data-phase={phase} aria-hidden="true">
      <div className="parse-msg" key={example.key}>
        {/* Ненабранное стоит невидимым: пузырь сразу своего размера, и экран под ним не прыгает. */}
        {parts.map((p, i) => {
          const cut = Math.min(p.text.length, Math.max(0, left));
          const caret = phase === 'typing' && left >= 0 && left <= p.text.length;
          left -= p.text.length;
          const body = <>{p.text.slice(0, cut)}{caret && <i className="parse-caret" />}<span className="parse-ghost">{p.text.slice(cut)}</span></>;
          return p.field === undefined ? <span key={i}>{body}</span> : <mark key={i} data-lit={lit(p.field) || undefined}>{body}</mark>;
        })}
      </div>

      <div className="parse-bot">
        <span className="parse-avatar">🤖</span>
        <Status phase={phase} example={example} />
      </div>

      <div className="parse-card" data-open={open || undefined}>
        <div className="parse-card-head">
          <b>{example.emoji} {example.title}</b>
          <span className="parse-badge" data-on={phase === 'done' || undefined}>{example.badge}</span>
        </div>
        {example.fields.map((f, i) => (
          <div key={`${example.key}-${i}`} className="parse-field" data-in={i < revealed || undefined}>
            <span>{f.label}</span>
            {i < revealed ? <b>{f.value}</b> : <i className="parse-skel" style={{ width: `${40 + ((i * 37) % 45)}%` }} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function Status({ phase, example }: { phase: DemoPhase; example: DemoExample }) {
  if (phase === 'typing') return <span className="parse-status">ждёт сообщение…</span>;
  if (phase === 'reading') return <span className="parse-status">читает <i className="parse-dots"><i /><i /><i /></i></span>;
  if (phase === 'parsing') return <span className="parse-status">{example.status?.parsing ?? STATUS.parsing}</span>;
  return <span className="parse-status ok">{example.status?.done ?? STATUS.done}</span>;
}
