import type { Practice } from '@yaswami/core';
import { topicIcon } from '@yaswami/core';

/** Строка услуги мастера (Practice): иконка темы, название, цена и описание; справа — «Записаться». */
export function PracticeRow({ practice: p, onSignUp }: { practice: Practice; onSignUp: () => void }) {
  return (
    <div className="guest">
      <img src={topicIcon(p.topic)} alt="" width={36} height={36} />
      <div>{p.title}<small>{[p.price ?? 'цена по запросу', p.description].filter(Boolean).join(' · ')}</small></div>
      <button className="signup" onClick={onSignUp}>Записаться</button>
    </div>
  );
}
