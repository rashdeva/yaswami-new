import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import type { HostSearch, HostSearchMatch, Wire } from '@yaswami/core';
import { HostSearchCreateInput } from '@yaswami/core';
import { useViewed } from '../hooks/useViewed.ts';

interface Props {
  searches: Wire<HostSearch>[];
  matches: Wire<HostSearchMatch>[];
  onCreate: (query: string) => Promise<unknown>;
  onActive: (id: string, active: boolean) => Promise<unknown>;
  onRemove: (id: string) => Promise<unknown>;
  onContact: (match: Wire<HostSearchMatch>) => void;
  toast: (text: string) => void;
}

const ago = (iso: string) => {
  const hours = Math.round((Date.now() - Date.parse(iso)) / 3600e3);
  return hours < 1 ? 'только что' : hours < 24 ? `${hours} ч назад` : `${Math.round(hours / 24)} дн. назад`;
};

/** Поиск людей для организатора: что он ищет в чатах города и кто нашёлся. Пишет людям он сам. */
export function PeopleScreen({ searches, matches, onCreate, onActive, onRemove, onContact, toast }: Props) {
  useViewed('host_searches_viewed');
  const { register, handleSubmit, reset, formState: { isValid, isSubmitting } } = useForm({ resolver: zodResolver(HostSearchCreateInput), mode: 'onChange', defaultValues: { query: '' } });
  const fail = (e: unknown) => toast((e as Error).message);
  const add = handleSubmit(async ({ query }) => {
    try {
      await onCreate(query);
      reset();
    } catch (e) {
      fail(e);
    }
  });
  const queryOf = new Map(searches.map((s) => [s.id, s.query]));

  return (
    <>
      <div className="top">
        <h1>Поиск людей</h1>
        <p>Опишите, кого ищете, — мы следим за большими чатами города и покажем тех, кто спрашивает о вашем. Написать им можно в один тап.</p>
      </div>

      <h2>Что ищем</h2>
      <form className="group" onSubmit={add} noValidate>
        {searches.map((s) => (
          <div key={s.id} className="item claim">
            <div>
              <b>{s.query}</b>
              <small>{s.status === 'active' ? 'ищем' : s.status === 'suggested' ? 'предлагаем — включите, если подходит' : 'выключен'}</small>
            </div>
            <button type="button" className="chip" aria-pressed={s.status === 'active'} onClick={() => onActive(s.id, s.status !== 'active').catch(fail)}>
              {s.status === 'active' ? 'Пауза' : 'Искать'}
            </button>
            <button type="button" className="chip" aria-label={`Удалить «${s.query}»`} onClick={() => onRemove(s.id).catch(fail)}>✕</button>
          </div>
        ))}
        <div className="row">
          <input aria-label="Кого ищем" placeholder="Например: ищут массаж, болит спина" maxLength={300} {...register('query')} />
          <button className="chip" type="submit" disabled={!isValid || isSubmitting}>Добавить</button>
        </div>
      </form>

      <h2>Нашлись</h2>
      {matches.length === 0 ? (
        <p className="note">Пока никого. Новые сообщения в чатах проверяем каждые 15 минут.</p>
      ) : (
        <div className="group">
          {matches.map((m) => (
            <div key={m.id} className="item claim">
              <div>
                <b>{m.author_name}{m.author_username ? ` · @${m.author_username}` : ''}</b>
                <small>{m.text}</small>
                <small>{ago(m.sent_at)} · {queryOf.get(m.search_id) ?? ''}</small>
              </div>
              <button className="chip" onClick={() => onContact(m)}>Написать</button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
