import { useState } from 'react';
import type { HostItem } from '@yaswami/core';
import { FEEDBACK_BONUS_MAX } from '@yaswami/core';
import { track } from '../analytics.ts';
import { reputation, starsOf } from '../format.ts';
import { useHostSelf } from '../hooks/useHostFeedback.ts';
import { openExternal } from '../tg.ts';

interface Props {
  host: HostItem;
  /** Человек смотрит собственную страницу: вместо «Оставить отзыв» — ссылка для клиентов и бонус за отзыв. */
  own: boolean;
}

/**
 * Отзывы на странице мастера: репутация (оценки его событий и услуг), тексты отзывов «рекомендую» и бонус за отзыв.
 * Формы здесь нет: «Оставить отзыв» ведёт в бота (`feedback_url`) — там оценка, а потом текст, пересланное сообщение
 * или ссылка на него. Мастеру на своей странице — та же ссылка для клиентов и поле бонуса.
 */
export function HostFeedback({ host, own }: Props) {
  const summary = reputation(host.feedback);
  const canLeave = !own && host.practices.length > 0;
  if (!summary && !host.feedback_entries.length && !canLeave && !own) return null;

  return (
    <>
      <h2>Отзывы</h2>
      {summary && <p className="note rating">{summary}</p>}
      {host.feedback_entries.length > 0 && (
        <div className="group">
          {host.feedback_entries.map((f, i) => (
            <div className="review" key={i}>
              <b>{f.user_first_name} <span aria-label={`Оценка ${f.rating} из 5`}>{starsOf(f.rating)}</span></b>
              <p>{f.comment}</p>
              <small>
                {f.practice_title}{f.via === 'invite' ? ' · по приглашению мастера' : ' · записывался через Я с вами'}
                {f.source_url && <> · <a href={f.source_url} target="_blank" rel="noreferrer">источник</a></>}
              </small>
            </div>
          ))}
        </div>
      )}
      {!summary && !host.feedback_entries.length && !own && <p className="note">Отзывов пока нет.</p>}
      {host.feedback_bonus && !own && <p className="note">🎁 За отзыв мастер обещает: {host.feedback_bonus}</p>}
      {canLeave && (
        <div className="review-cta">
          <button className="cta alt" onClick={() => { track('host_feedback_opened', { host_id: host.id }); openExternal(host.feedback_url); }}>Оставить отзыв в боте</button>
        </div>
      )}
      {own && <OwnFeedback />}
    </>
  );
}

/** Мастеру на своей странице: ссылка, по которой клиенты оставляют отзыв в боте, и что он даёт за отзыв. */
function OwnFeedback() {
  const { self, save, saving, saved, failed } = useHostSelf(true);
  const [copied, setCopied] = useState(false);
  const [bonus, setBonus] = useState<string | null>(null); // null — поле не трогали: показываем сохранённое
  if (!self) return null;
  const value = bonus ?? self.feedback_bonus ?? '';
  const copy = () => {
    track('host_feedback_link_copied', { host_id: self.host_id });
    void navigator.clipboard.writeText(self.feedback_url).then(() => setCopied(true), () => setCopied(false));
  };

  return (
    <section className="suggest">
      <b>Соберите отзывы</b>
      <p>Отправьте клиентам ссылку: она откроет бота, он спросит оценку и попросит написать отзыв или переслать сообщение с ним. Записываться через Я с вами для этого не нужно.</p>
      <button className="cta alt" onClick={copy}>{copied ? 'Ссылка скопирована' : 'Скопировать ссылку'}</button>
      <form onSubmit={(e) => { e.preventDefault(); save({ feedback_bonus: value.trim() || null }); }}>
        <div className="group">
          <div className="row">
            <input value={value} onChange={(e) => setBonus(e.target.value)} maxLength={FEEDBACK_BONUS_MAX} placeholder="Бонус за отзыв: −10% на следующий визит" aria-label="Бонус за отзыв" />
          </div>
        </div>
        {failed ? <p className="error">{failed.message}</p>
          : <p className="note">{saved && bonus !== null ? 'Сохранено. ' : ''}Гость увидит бонус на вашей странице и в боте после оценки. Он за любой отзыв, не только за хороший; исполняете его вы сами.</p>}
        <button className="cta alt" type="submit" disabled={saving || bonus === null}>{saving ? 'Сохраняем…' : 'Сохранить бонус'}</button>
      </form>
    </section>
  );
}
