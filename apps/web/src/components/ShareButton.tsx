/** Круглая кнопка «Поделиться» слева от главного действия в нижней панели. */
export function ShareButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="cta alt share" aria-label="Поделиться" onClick={onClick}>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3.5v11M7.5 8 12 3.5 16.5 8" />
        <path d="M8 11H6.5A2 2 0 0 0 4.5 13v5.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V13a2 2 0 0 0-2-2H16" />
      </svg>
    </button>
  );
}
