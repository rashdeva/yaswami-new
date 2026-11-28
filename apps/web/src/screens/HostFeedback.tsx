import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Drawer } from 'vaul';
import type { HostFeedbackCreateInput, HostItem } from '@yaswami/core';
import { FEEDBACK_BONUS_MAX, FEEDBACK_PUBLIC_RATING, HostFeedbackCreateInput as Schema, isPublicFeedback } from '@yaswami/core';
import { track } from '../analytics.ts';
import { reputation, starsOf } from '../format.ts';
import { useHostFeedback, useHostSelf } from '../hooks/useHostFeedback.ts';

interface Props {
  host: HostItem;
  /** Человек смотрит собственную страницу: вместо формы отзыва — ссылка для клиентов и бонус за отзыв. */
  own: boolean;
  authed: boolean;
  /** Гость на сайте: сначала войти. null — войти здесь нельзя. */
  onLogin: (() => void) | null;
  /** Открыть форму сразу: человек пришёл по ссылке мастера «оставьте отзыв». */
  openForm: boolean;
}

/**
 * Отзывы на странице мастера: репутация (оценки его событий и услуг), тексты отзывов «рекомендую», бонус за отзыв
 * и форма отзыва на услугу. Мастеру на своей странице — ссылка для клиентов и поле бонуса.
 */
export function HostFeedback({ host, own, authed, onLogin, openForm }: Props) {
  const [open, setOpen] = useState(openForm && !own && authed && host.practices.length > 0);
  const summary = reputation(host.feedback);
  const canLeave = !own && host.practices.length > 0 && (authed || !!onLogin);
  if (!summary && !host.feedback_entries.length && !host.feedback_bonus && !canLeave && !own) return null;

  const start = () => {
    track('host_feedback_opened', { host_id: host.id });
    if (authed) setOpen(true);
    else onLogin!();
  };

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
              <small>{f.practice_title}{f.via === 'invite' ? ' · по приглашению мастера' : ' · записывался через Я с вами'}</small>
            </div>
          ))}
        </div>
      )}
      {!summary && !host.feedback_entries.length && !own && <p className="note">Отзывов пока нет.</p>}
      {host.feedback_bonus && !own && <p className="note">🎁 За отзыв мастер обещает: {host.feedback_bonus}</p>}
      {canLeave && <div className="review-cta"><button className="cta alt" onClick={start}>Оставить отзыв</button></div>}
      {own && <OwnFeedback />}
      {canLeave && authed && <FeedbackDrawer host={host} open={open} onOpenChange={setOpen} />}
    </>
  );
}

function FeedbackDrawer({ host, open, onOpenChange }: { host: HostItem; open: boolean; onOpenChange: (open: boolean) => void }) {
  const leave = useHostFeedback(host.id);
  const { register, handleSubmit, setValue, watch, reset, formState: { errors } } = useForm<HostFeedbackCreateInput>({
    resolver: zodResolver(Schema), defaultValues: { practice_id: host.practices[0]!.id, comment: '' },
  });
  const [practiceId, rating] = [watch('practice_id'), watch('rating')];
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      leave.reset();
      reset();
    }
  };
  const problem = (errors.rating && 'Поставьте оценку') || errors.comment?.message || leave.error?.message;

  return (
    <Drawer.Root open={open} onOpenChange={close}>
      <Drawer.Portal>
        <Drawer.Overlay className="drawer-overlay" />
        <Drawer.Content className="drawer" aria-describedby={undefined}>
          <Drawer.Handle className="drawer-handle" />
          <Drawer.Title className="sr">Отзыв о мастере</Drawer.Title>
          {leave.data ? (
            <>
              <p className="who">🙏 Спасибо за отзыв!</p>
              {leave.data.feedback_bonus
                ? <p>🎁 Мастер благодарит за отзыв: {leave.data.feedback_bonus}. Покажите этот экран мастеру.</p>
                : <p>{isPublicFeedback(leave.data) ? 'Он появится на странице мастера.' : 'Мастер его увидит.'}</p>}
              <button className="cta" onClick={() => close(false)}>Готово</button>
            </>
          ) : (
            <form onSubmit={handleSubmit((input) => leave.mutate(input))}>
              <p className="who">Как прошло у {host.name}?</p>
              {host.practices.length > 1 && (
                <div className="chips wrap">
                  {host.practices.map((p) => (
                    <button type="button" className="chip" key={p.id} aria-pressed={p.id === practiceId} onClick={() => setValue('practice_id', p.id)}>{p.title}</button>
                  ))}
                </div>
              )}
              <div className="stars" role="radiogroup" aria-label="Оценка">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button type="button" key={n} role="radio" aria-checked={rating === n} aria-label={`${n} из 5`} data-on={rating >= n}
                    onClick={() => setValue('rating', n, { shouldValidate: true })}>★</button>
                ))}
              </div>
              <div className="group">
                <div className="row tall"><textarea {...register('comment')} placeholder="Пара слов: что понравилось, что нет" aria-label="Отзыв" rows={3} /></div>
              </div>
              {problem ? <p className="error">{problem}</p>
                : <p className="note">Отзыв с оценкой {FEEDBACK_PUBLIC_RATING}–5 увидят все на странице мастера, с оценкой ниже — только мастер.</p>}
              <button className="cta" type="submit" disabled={leave.isPending}>{leave.isPending ? 'Отправляем…' : 'Отправить'}</button>
            </form>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

/** Мастеру на своей странице: ссылка, по которой клиенты оставляют отзыв, и что он даёт за отзыв. */
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
      <p>Отправьте клиентам ссылку — они оставят отзыв о вас, даже если записывались не через Я с вами.</p>
      <button className="cta alt" onClick={copy}>{copied ? 'Ссылка скопирована' : 'Скопировать ссылку'}</button>
      <form onSubmit={(e) => { e.preventDefault(); save({ feedback_bonus: value.trim() || null }); }}>
        <div className="group">
          <div className="row">
            <input value={value} onChange={(e) => setBonus(e.target.value)} maxLength={FEEDBACK_BONUS_MAX} placeholder="Бонус за отзыв: −10% на следующий визит" aria-label="Бонус за отзыв" />
          </div>
        </div>
        {failed ? <p className="error">{failed.message}</p>
          : <p className="note">{saved && bonus !== null ? 'Сохранено. ' : ''}Гость увидит бонус на вашей странице и после отзыва. Он за любой отзыв, не только за хороший; исполняете его вы сами.</p>}
        <button className="cta alt" type="submit" disabled={saving || bonus === null}>{saving ? 'Сохраняем…' : 'Сохранить бонус'}</button>
      </form>
    </section>
  );
}
