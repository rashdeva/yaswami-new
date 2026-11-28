// «Добавить»: форм нет — событие, товар или услугу человек описывает боту своими словами, бот разбирает сам
// (роль поддержки Hermes, скиллы my-events и my-offers). Экран объясняет это и показывает разбор вживую.
import { useEffect } from 'react';
import type { AddKind } from '../add.ts';
import { ADD_EXAMPLE_LIST, ADD_KINDS } from '../add.ts';
import { track } from '../analytics.ts';
import { botChatLink } from '../format.ts';
import { ParseDemo } from '../components/ParseDemo.tsx';
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
  const demo = useParseDemo(ADD_EXAMPLE_LIST, ADD_KINDS.indexOf(initial));
  const kind = ADD_KINDS[demo.index]!;
  // Бот узнаёт, что именно человек добавляет: выбранная плашка уходит намерением в ссылке.
  const bot = botChatLink({ type: 'add', kind });
  useViewed('add_viewed');
  useEffect(() => { document.title = 'Добавить через бота — Я с вами'; }, []);

  const open = () => {
    if (!bot) return;
    haptic.tap();
    track('add_bot_opened', { kind });
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
        {ADD_EXAMPLE_LIST.map((e, i) => (
          <button key={e.kind} className="chip" role="tab" aria-selected={demo.index === i} aria-pressed={demo.index === i}
            onClick={() => { haptic.select(); demo.pick(i); }}>
            {e.emoji} {e.chip}
          </button>
        ))}
      </div>

      <ParseDemo {...demo} />

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
