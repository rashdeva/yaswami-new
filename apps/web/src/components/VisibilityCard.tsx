import { shortLink, showcaseState } from '../visibility.ts';
import type { EventData } from '../api.ts';

interface Props {
  event: EventData['event'];
  /** Ссылка, по которой событие открывается у гостя (в бота). */
  link: string;
  /** Идёт сохранение: переключатель ждёт ответа. */
  saving: boolean;
  onChange: (visibility: 'public' | 'private') => void;
  onCopy: () => void;
}

/** Организатору: кто видит событие. Переключатель афиши, что с ней сейчас и ссылка для своих (ADR-0014). */
export function VisibilityCard({ event, link, saving, onChange, onCopy }: Props) {
  const state = showcaseState(event);
  return (
    <div className="group vis">
      <div className="row">
        <span className="vis-ico" aria-hidden="true">
          <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 10h18M8 15h4" /></svg>
        </span>
        <b>Афиша города</b>
        <button type="button" className="sw" role="switch" aria-checked={state.wanted} aria-label="Показывать в афише города" disabled={saving}
          onClick={() => onChange(state.wanted ? 'private' : 'public')} />
      </div>
      <div className="vis-state">
        <span className={`badge ${state.tone}`}>{state.badge}</span>
        <p>{state.note}</p>
      </div>
      <div className="row vis-link">
        <span>{shortLink(link)}</span>
        <button type="button" onClick={onCopy}>Скопировать</button>
      </div>
    </div>
  );
}
