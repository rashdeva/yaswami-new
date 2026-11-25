import type { Practice } from '@yaswami/core';
import { topicIcon } from '@yaswami/core';
import { formatLabel, practicePrice } from '../services.ts';

/**
 * Строка услуги на странице мастера (Practice): иконка темы, название, формат и цена. Кнопки записи нет —
 * нажатие открывает шторку услуги (PracticeSheet), как на вкладке «Услуги».
 */
export function PracticeRow({ practice: p, onOpen }: { practice: Practice; onOpen: () => void }) {
  return (
    <button className="service" onClick={onOpen}>
      <img src={topicIcon(p.topic)} alt="" width={36} height={36} />
      <span className="service-text">
        <b>{p.title}</b>
        <small>{[formatLabel(p), practicePrice(p)].filter(Boolean).join(' · ')}</small>
      </span>
      <span className="service-chev" aria-hidden="true">›</span>
    </button>
  );
}
