// Админка, раздел «События»: модерация собранных событий. Новое событие ждёт решения; одобренное проходит
// обработку (обложка и ролик) и выходит в ленту; опубликованное можно снять или удалить.
import { useCallback, useEffect, useState } from 'react';
import type { AdminCollectedEvent, CollectedStatus } from '@yaswami/core';
import { collectedPath, collectedWhen } from '@yaswami/core';
import { api } from '../api.ts';

const POLL_MS = 30_000; // события появляются раз в проход сборщика, чаще опрашивать незачем

/** Список событий для модерации: загружается сразу (нужен счётчик на вкладке) и обновляется опросом. */
export function useModeration() {
  const [items, setItems] = useState<AdminCollectedEvent[] | null>(null);
  const reload = useCallback(() => api.adminEvents().then(setItems, () => {}), []);
  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(timer);
  }, [reload]);
  return { items, reload };
}

const GROUPS: { status: CollectedStatus; title: string; hint: string }[] = [
  { status: 'pending', title: 'Ждут решения', hint: 'Сборщик разобрал анонс. В ленте события нет, пока вы его не одобрите.' },
  { status: 'approved', title: 'Обрабатываются', hint: 'Одобрены: иллюстратор делает обложку и ролик, после этого событие само выйдет в ленту.' },
  { status: 'published', title: 'В ленте', hint: 'Видны всем. Событие можно снять с публикации или удалить.' },
  { status: 'rejected', title: 'Отклонены', hint: 'Не выводятся нигде. Остаются в базе, чтобы повторный анонс не создал событие заново.' },
];

interface Props {
  items: AdminCollectedEvent[] | null;
  /** Выполнить действие и показать ошибку в шапке админки, если оно не удалось. */
  act: (action: Promise<unknown>) => Promise<void>;
  reload: () => Promise<void>;
}

export function Events({ items, act, reload }: Props) {
  const run = (action: Promise<unknown>) => act(action).then(reload);
  const card = (e: AdminCollectedEvent) => (
    <div key={e.id} className="ad-card ad-event">
      {e.cover_url ? <img src={e.cover_url} alt="" loading="lazy" /> : <div className="ad-nocover">нет фото</div>}
      <div>
        <strong>{e.title}</strong>
        <div className="ad-hint">
          {[collectedWhen(e.starts_at), e.place, e.price].filter(Boolean).join(' · ')}
        </div>
        <div className="ad-hint">
          {[e.topic, `источник: ${e.channel}`, e.video_url && 'есть ролик'].filter(Boolean).join(' · ')}
        </div>
        {e.description && <p className="ad-desc">{e.description}</p>}
        <div className="ad-inline">
          <a className="ad-link" href={e.source_url} target="_blank" rel="noreferrer">исходный анонс</a>
          {e.status === 'published' && <a className="ad-link" href={collectedPath(e.id)} target="_blank" rel="noreferrer">страница события</a>}
        </div>
        <div className="ad-inline">
          {(e.status === 'pending' || e.status === 'rejected') && (
            <button className="ad-btn" onClick={() => void run(api.adminEventModerate(e.id, 'approved'))}>Одобрить</button>
          )}
          {e.status !== 'rejected' && (
            <button className="ad-btn ghost" onClick={() => void run(api.adminEventModerate(e.id, 'rejected'))}>
              {e.status === 'pending' ? 'Отклонить' : 'Снять с публикации'}
            </button>
          )}
          {e.status !== 'pending' && (
            <button
              className="ad-btn ghost"
              onClick={() => { if (confirm(`Удалить «${e.title}» совсем? Повторный анонс создаст событие заново.`)) void run(api.adminEventDelete(e.id)); }}
            >
              Удалить
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <main>
      <div className="ad-wide">
        <h2>События</h2>
        {!items && <p className="ad-hint">Загружаю…</p>}
        {items && GROUPS.map(({ status, title, hint }) => {
          const list = items.filter((e) => e.status === status);
          // Пустые «обрабатываются» и «отклонены» не показываем; «ждут решения» — всегда, чтобы было видно, что очередь пуста.
          if (!list.length && status !== 'pending') return null;
          return (
            <section key={status}>
              <h3>{title} <b className="ad-badge">{list.length}</b></h3>
              <p className="ad-hint">{list.length ? hint : 'Новых событий нет.'}</p>
              <div className="ad-cards">{list.map(card)}</div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
