import { useCallback, useEffect, useState } from 'react';
import type { DemoExample } from '../add.ts';

/** typing — человек набирает сообщение; reading — бот читает; parsing — поля встают в карточку по одному; done — пауза. */
export type DemoPhase = 'typing' | 'reading' | 'parsing' | 'done';

/** Что рисует `ParseDemo`: пример и где сейчас показ. */
export interface ParseDemoState {
  example: DemoExample;
  phase: DemoPhase;
  typed: number;
  revealed: number;
}

const TYPE_MS = 26; // на символ
const READ_MS = 1100;
const FIELD_MS = 430;
const HOLD_MS = 3200;

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Показ разбора (компонент `ParseDemo`): сообщение печатается, бот подсвечивает куски и раскладывает их в поля,
 * затем следующий пример по кругу; один пример повторяется сам. `pick` начинает показ с выбранного примера.
 * Без анимаций (reduced motion) — сразу итог, без круга. `examples` — постоянный список: не собирайте его при рендере.
 */
export function useParseDemo(examples: readonly DemoExample[], start = 0) {
  const still = reducedMotion();
  const [index, setIndex] = useState(start);
  const [phase, setPhase] = useState<DemoPhase>(still ? 'done' : 'typing');
  const [typed, setTyped] = useState(0);
  const [revealed, setRevealed] = useState(0);
  const example = examples[index]!;
  const total = example.fields.length;

  const pick = useCallback((next: number) => {
    setIndex(next);
    setTyped(0);
    setRevealed(still ? examples[next]!.fields.length : 0);
    setPhase(still ? 'done' : 'typing');
  }, [still, examples]);

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
    const t = setTimeout(() => pick((index + 1) % examples.length), HOLD_MS);
    return () => clearTimeout(t);
  }, [still, phase, typed, revealed, total, example.message.length, index, examples.length, pick]);

  return { index, example, phase, typed: phase === 'typing' ? typed : example.message.length, revealed, pick };
}
