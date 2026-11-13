import { hue } from '../format.ts';

/** Строка списка гостей: кружок с фото (или буквой) и имя, под именем — `sub`; справа — подпись. */
export function GuestRow({ name, photo, label, sub, children }: { name: string; photo: string | null; label?: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="guest">
      <div className="ava" style={{ background: `hsl(${hue(name)},55%,48%)` }}>
        {[...name][0]}
        {/* Фото поверх буквы: не загрузилось — остаётся кружок с буквой. */}
        {photo && <img src={photo} alt="" loading="lazy" onError={(e) => { e.currentTarget.hidden = true; }} />}
      </div>
      {sub ? <div>{name}<small>{sub}</small></div> : name}{children}
      {label && <span>{label}</span>}
    </div>
  );
}
