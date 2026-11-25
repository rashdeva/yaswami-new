/** Строка поиска в шапке раздела («События», «Услуги»): лупа, поле и крестик, когда что-то набрано. */
export function SearchField({ value, placeholder, label, onChange }: { value: string; placeholder: string; label: string; onChange: (value: string) => void }) {
  return (
    <label className="find-field">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></svg>
      <input type="search" enterKeyHint="search" placeholder={placeholder} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
      {value && (
        <button type="button" className="find-clear" aria-label="Очистить поиск" onClick={() => onChange('')}>
          <svg viewBox="0 0 10 10" aria-hidden="true"><path d="m2 2 6 6M8 2 2 8" /></svg>
        </button>
      )}
    </label>
  );
}
