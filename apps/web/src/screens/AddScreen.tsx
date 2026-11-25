// «Добавить»: форм нет — событие, товар или услугу человек описывает боту своими словами, бот разбирает сам
// (роль поддержки Hermes, скиллы my-events и my-offers). Экран объясняет это и показывает разбор вживую.
import { useEffect } from 'react';
import type { AddKind } from '../add.ts';
import { ADD_EXAMPLES, ADD_KINDS, segments } from '../add.ts';
import { track } from '../analytics.ts';
import { botChatLink } from '../format.ts';
import type { DemoPhase } from '../hooks/useParseDemo.ts';
import { useParseDemo } from '../hooks/useParseDemo.ts';
import { useViewed } from '../hooks/useViewed.ts';
import { haptic, openExternal } from '../tg.ts';

interface Props {
  kind: AddKind;
  /** Кнопка «назад» на странице; null — её рисует Telegram. */
  onBack: (() => void) | null;
}

const STEPS = [
  { emoji: '💬', text: 'Напишите боту, как написали бы другу. Можно голосовым или переслать свой пост.' },
  { emoji: '✨', text: 'Бот сам разберёт текст и покажет, что понял. Чего не хватает, переспросит.' },
  { emoji: '✅', text: 'Скажите «да». Команда быстро посмотрит, и всё появится в приложении.' },
];

export function AddScreen({ kind: initial, onBack }: Props) {
  const demo = useParseDemo(initial);
  const bot = botChatLink();
  useViewed('add_viewed');
  useEffect(() => { document.title = 'Добавить через бота — Я с вами'; }, []);

  const open = () => {
    if (!bot) return;
    haptic.tap();
    track('add_bot_opened', { kind: demo.kind });
    openExternal(bot);
  };

  return (
    <>
      <div className="top">
        {onBack && <button className="chip" onClick={onBack}>← Назад</button>}
        <h1>Просто напишите боту</h1>
        <p>Без форм и полей. Расскажите о событии, товаре или услуге своими словами, а бот всё разберёт сам.</p>
      </div>

      <div className="chips add-kinds" role="tablist" aria-label="Что добавить">
        {ADD_KINDS.map((k) => (
          <button key={k} className="chip" role="tab" aria-selected={demo.kind === k} aria-pressed={demo.kind === k}
            onClick={() => { haptic.select(); demo.pick(k); }}>
            {ADD_EXAMPLES[k].emoji} {ADD_EXAMPLES[k].chip}
          </button>
        ))}
      </div>

      <Demo {...demo} />

      <h2>Как это работает</h2>
      <ol className="group add-steps">
        {STEPS.map((s) => <li key={s.emoji} className="row"><span aria-hidden="true">{s.emoji}</span><span>{s.text}</span></li>)}
      </ol>
      <p className="note">Товары берём только сделанные своими руками. Заказы и запись идут напрямую вам в Telegram.</p>

      <div className="main"><div>
        <button className="cta" onClick={open} disabled={!bot}>Написать боту</button>
      </div></div>
    </>
  );
}

/** Сцена разбора: сообщение человека, бот читает, куски текста подсвечиваются и встают полями в карточку. */
function Demo({ example, phase, typed, revealed }: ReturnType<typeof useParseDemo>) {
  const parts = segments(example.message, example.fields);
  const lit = (field: number | undefined) => field !== undefined && field < revealed;
  let left = typed; // сколько символов уже набрано: куски за этой границей не видны
  return (
    <div className="parse" data-phase={phase} aria-hidden="true">
      <div className="parse-msg" key={example.kind}>
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
        <Status phase={phase} />
      </div>

      <div className="parse-card" data-open={phase === 'parsing' || phase === 'done' || undefined}>
        <div className="parse-card-head">
          <b>{example.emoji} {example.title}</b>
          <span className="parse-badge" data-on={phase === 'done' || undefined}>Добавляем?</span>
        </div>
        {example.fields.map((f, i) => (
          <div key={`${example.kind}-${i}`} className="parse-field" data-in={i < revealed || undefined}>
            <span>{f.label}</span>
            {i < revealed ? <b>{f.value}</b> : <i className="parse-skel" style={{ width: `${40 + ((i * 37) % 45)}%` }} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function Status({ phase }: { phase: DemoPhase }) {
  if (phase === 'typing') return <span className="parse-status">ждёт сообщение…</span>;
  if (phase === 'reading') return <span className="parse-status">читает <i className="parse-dots"><i /><i /><i /></i></span>;
  if (phase === 'parsing') return <span className="parse-status">раскладывает по полям</span>;
  return <span className="parse-status ok">готово, проверьте</span>;
}
