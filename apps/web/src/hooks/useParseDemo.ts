import { useCallback, useEffect, useState } from 'react';
import type { AddKind } from '../add.ts';
import { ADD_EXAMPLES, ADD_KINDS } from '../add.ts';

/** typing — человек набирает сообщение; reading — бот читает; parsing — поля встают в карточку по одному; done — пауза. */
export type DemoPhase = 'typing' | 'reading' | 'parsing' | 'done';

const TYPE_MS = 26; // на символ
const READ_MS = 1100;
const FIELD_MS = 430;
const HOLD_MS = 3200;

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Показ разбора на экране «Добавить»: сообщение печатается, бот подсвечивает куски и раскладывает их в поля,
 * затем следующий пример по кругу. Выбор плашки начинает показ с неё. Без анимаций (reduced motion) — сразу итог, без круга.
 */
export function useParseDemo(initial: AddKind) {
  const still = reducedMotion();
  const [kind, setKind] = useState(initial);
  const [phase, setPhase] = useState<DemoPhase>(still ? 'done' : 'typing');
  const [typed, setTyped] = useState(0);
  const [revealed, setRevealed] = useState(0);
  const example = ADD_EXAMPLES[kind];
  const total = example.fields.length;

  const pick = useCallback((next: AddKind) => {
    setKind(next);
    setTyped(0);
    setRevealed(still ? ADD_EXAMPLES[next].fields.length : 0);
    setPhase(still ? 'done' : 'typing');
  }, [still]);

  useEffect(() => {
    if (still) return void setRevealed(total);
    if (phase === 'typing') {
      if (typed >= example.message.length) return void setPhase('reading');
      const t = setTimeout(() => setTyped((n) => n + 1), TYPE_MS);
      return () => clearTimeout(t);
    }
    if (phase === 'reading') {
      const t = setTimeout(() => setPhase('parsing'), READ_MS);
      return () => clearTimeout(t);
    }
    if (phase === 'parsing') {
      if (revealed >= total) return void setPhase('done');
      const t = setTimeout(() => setRevealed((n) => n + 1), FIELD_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => pick(ADD_KINDS[(ADD_KINDS.indexOf(kind) + 1) % ADD_KINDS.length]!), HOLD_MS);
    return () => clearTimeout(t);
  }, [still, phase, typed, revealed, total, example.message.length, kind, pick]);

  return { kind, example, phase, typed: phase === 'typing' ? typed : example.message.length, revealed, pick };
}
