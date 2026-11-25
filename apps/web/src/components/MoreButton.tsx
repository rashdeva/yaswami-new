/** «Все N ›» в шапке полки: открыть подборку целиком. Одна кнопка на событиях и услугах — стиль `.shelf-head .more`. */
export function MoreButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button className="more" onClick={onClick}>
      Все {count}
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" /></svg>
    </button>
  );
}
