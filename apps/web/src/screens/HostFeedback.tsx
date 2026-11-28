import { useState } from 'react';
import { Drawer } from 'vaul';
import type { HostItem } from '@yaswami/core';
import { FEEDBACK_BONUS_MAX, FEEDBACK_PUBLIC_RATING } from '@yaswami/core';
import { FEEDBACK_EXAMPLES } from '../add.ts';
import { ParseDemo } from '../components/ParseDemo.tsx';
import { useParseDemo } from '../hooks/useParseDemo.ts';
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
 * Формы здесь нет: «Оставить отзыв» открывает шторку с показом, как это происходит в боте (`ParseDemo`), и ведёт
 * в бота (`feedback_url`) — там оценка, а потом текст, пересланное сообщение или ссылка на него.
 * Мастеру на своей странице — та же ссылка для клиентов, тот же показ и поле бонуса.
 */
export function HostFeedback({ host, own }: Props) {
  const [how, setHow] = useState(false);
  const show = () => {
    track('host_feedback_opened', { host_id: host.id, own });
    setHow(true);
  };
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
              {/* Голосовой отзыв: запись и под ней её расшифровка. Не загружаем, пока не нажали: отзывов на странице много. */}
              {f.audio_url && <audio className="review-audio" controls preload="none" src={f.audio_url} aria-label={`Голосовой отзыв: ${f.user_first_name}`} />}
              {f.comment && <p>{f.comment}</p>}
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
          <button className="cta alt" onClick={show}>Оставить отзыв</button>
        </div>
      )}
      {own && <OwnFeedback onShow={show} />}
      <Drawer.Root open={how} onOpenChange={setHow}>
        <Drawer.Portal>
          <Drawer.Overlay className="drawer-overlay" />
          <Drawer.Content className="drawer" aria-describedby={undefined}>
            <Drawer.Handle className="drawer-handle" />
            <Drawer.Title className="who">Отзыв — в боте, без форм</Drawer.Title>
            {how && <FeedbackDemo />}
            <ol className="group add-steps">
              {STEPS.map((s) => <li key={s.emoji} className="row"><span aria-hidden="true">{s.emoji}</span><span>{s.text}</span></li>)}
            </ol>
            <div className="drawer-bar">
              {own
                ? <button className="cta" onClick={() => setHow(false)}>Понятно</button>
                : <button className="cta" onClick={() => { track('host_feedback_bot_opened', { host_id: host.id }); openExternal(host.feedback_url); }}>Открыть бота</button>}
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  );
}

const STEPS = [
  { emoji: '⭐', text: 'Бот спросит, были ли вы у мастера. Поставьте оценку — одно нажатие.' },
  { emoji: '💬', text: 'Напишите пару слов или запишите голосовое. Или перешлите своё сообщение с отзывом, или пришлите ссылку на него.' },
  { emoji: '✅', text: `Отзыв с оценкой ${FEEDBACK_PUBLIC_RATING}–5 появится на странице мастера: текст увидят, голосовое услышат все. С оценкой ниже — только мастер.` },
];

/** Показ в шторке: живёт, пока шторка открыта, — таймеры не тикают на каждой странице мастера. */
function FeedbackDemo() {
  return <ParseDemo {...useParseDemo(FEEDBACK_EXAMPLES)} />;
}

/** Мастеру на своей странице: ссылка, по которой клиенты оставляют отзыв в боте, и что он даёт за отзыв. */
function OwnFeedback({ onShow }: { onShow: () => void }) {
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
      <button className="quiet" onClick={onShow}>Как это видит клиент</button>
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
