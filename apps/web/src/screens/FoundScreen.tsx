import { useState } from 'react';
import type { CollectedEventItem } from '@yaswami/core';
import { collectedWhen, topicIcon, topicSlug } from '@yaswami/core';
import { foundCta, foundSignups, plural } from '../found.ts';
import { useTopics } from '../hooks/useTopics.ts';

interface Props {
  name: string;
  username: string | null;
  /** События афиши, где контактом для записи указан этот человек. */
  items: CollectedEventItem[];
  /** Подтвердить отмеченные; остальные — «не моё», о них больше не спрашиваем. */
  onConfirm: (picked: CollectedEventItem[], rest: CollectedEventItem[]) => Promise<void>;
  /** «Не сейчас»: уйти в афишу; вопрос останется в профиле. */
  onLater: () => void;
}

/** Первый экран организатора, чьи события уже в афише: «это ваши?» — подтвердить все разом (ADR-0014). */
export function FoundScreen({ name, username, items, onConfirm, onLater }: Props) {
  useTopics(); // иконки тем — из базы
  const [off, setOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const picked = items.filter((i) => !off.has(i.id));
  const signups = foundSignups(items);
  const toggle = (id: string) => setOff((prev) => { const next = new Set(prev); if (!next.delete(id)) next.add(id); return next; });
  const confirm = () => {
    setBusy(true);
    void onConfirm(picked, items.filter((i) => off.has(i.id))).finally(() => setBusy(false));
  };
  return (
    <div className="found">
      <div className="top">
        <div className="found-head">
          {username && <span className="chip">@{username}</span>}
          <button type="button" className="quiet" onClick={onLater}>Не сейчас</button>
        </div>
        <h1>{name}, это {items.length === 1 ? 'ваше событие' : 'ваши события'}?</h1>
        <p>{items.length === 1 ? 'Оно уже в афише' : 'Они уже в афише'}: мы собрали {items.length === 1 ? 'его' : 'их'} из открытых анонсов, а записываться там просят у вас.</p>
      </div>

      {signups > 0 && (
        <div className="stats found-stats">
          <div className="stat"><b>{signups}</b><span>{plural(signups, 'человек хочет', 'человека хотят', 'человек хотят')} прийти</span></div>
          <div className="stat"><b>{items.length}</b><span>{plural(items.length, 'событие', 'события', 'событий')} в афише</span></div>
        </div>
      )}

      <div className="group">
        {items.map((item) => (
          <button key={item.id} type="button" className="row found-item" role="checkbox" aria-checked={!off.has(item.id)} data-topic={topicSlug(item.topic)} onClick={() => toggle(item.id)}>
            {item.cover_url ? <img className="found-th" src={item.cover_url} alt="" loading="lazy" /> : <img className="found-th ico" src={topicIcon(item.topic)} alt="" loading="lazy" />}
            <span className="found-text">
              <time>{collectedWhen(item.starts_at)}</time>
              <b>{item.title}</b>
              <small>{[item.signups_count ? `${item.signups_count} ${plural(item.signups_count, 'записался', 'записались', 'записались')}` : null, item.place].filter(Boolean).join(' · ')}</small>
            </span>
            <i aria-hidden="true" />
          </button>
        ))}
      </div>
      <p className="note">Не ваше? Снимите отметку — на этом экране мы больше о нём не спросим.</p>

      <div className="found-perks">
        <span>Список гостей</span>
        <span>Правка событий</span>
        <span>Ссылка для своих</span>
      </div>

      {/* Кнопка в потоке, а не у края экрана: под ней — вкладки приложения. */}
      <div className="found-cta">
        <button type="button" className="cta" disabled={busy} onClick={confirm}>{busy ? 'Минуту…' : foundCta(picked.length)}</button>
      </div>
    </div>
  );
}
