import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Drawer } from 'vaul';
import type { SourceAddInput } from '@yaswami/core';
import { SOURCES_PER_DAY, SourceAddInput as Schema } from '@yaswami/core';
import { track } from '../analytics.ts';
import { useAddSource } from '../hooks/useAddSource.ts';

interface Props {
  city_id: string;
  authed: boolean;
  /** Гость на сайте: сначала войти. null — войти здесь нельзя (и предлагать нечего). */
  onLogin: (() => void) | null;
}

/**
 * Внизу «Всех событий»: гость предлагает канал Telegram или профиль Instagram с анонсами. Заявку решает команда в
 * админке; одобрит — бот напишет. Канал записывается за городом, который гость смотрит.
 */
export function SourceSuggest({ city_id, authed, onLogin }: Props) {
  const [open, setOpen] = useState(false);
  const add = useAddSource();
  const { register, handleSubmit, reset, formState: { errors } } = useForm<SourceAddInput>({ resolver: zodResolver(Schema), defaultValues: { channel: '' } });
  if (!authed && !onLogin) return null;

  const start = () => {
    track('source_suggest_opened');
    if (authed) setOpen(true);
    else onLogin!();
  };
  const close = (o: boolean) => {
    setOpen(o);
    if (!o) {
      add.reset();
      reset();
    }
  };
  const problem = errors.channel?.message ?? add.error?.message;

  return (
    <section className="suggest">
      <b>Знаете канал с анонсами?</b>
      <p>Пришлите Telegram-канал или Instagram, где пишут о событиях города. Проверим и начнём собирать события оттуда.</p>
      <button className="cta alt" onClick={start}>Предложить канал</button>
      <Drawer.Root open={open} onOpenChange={close}>
        <Drawer.Portal>
          <Drawer.Overlay className="drawer-overlay" />
          <Drawer.Content className="drawer" aria-describedby={undefined}>
            <Drawer.Handle className="drawer-handle" />
            <Drawer.Title className="sr">Предложить канал</Drawer.Title>
            {add.data ? (
              <>
                <p className="who">🙏 Спасибо!</p>
                <p>Команда посмотрит канал. Когда начнём его читать, бот напишет вам в Telegram.</p>
                <button className="cta" onClick={() => close(false)}>Готово</button>
              </>
            ) : (
              <form onSubmit={handleSubmit((input) => add.mutate({ ...input, city_id }))}>
                <span className="lead">Канал Telegram или профиль Instagram</span>
                <div className="group">
                  <div className="row" aria-invalid={!!problem}>
                    <input {...register('channel')} placeholder="@channel или instagram.com/…" autoComplete="off" autoCapitalize="off" enterKeyHint="send" aria-label="Канал" autoFocus />
                  </div>
                </div>
                {problem ? <p className="error">{problem}</p>
                  : <p className="note">Только каналы, не группы и не чаты. До {SOURCES_PER_DAY} в сутки.</p>}
                <button className="cta" type="submit" disabled={add.isPending}>{add.isPending ? 'Отправляем…' : 'Отправить'}</button>
              </form>
            )}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </section>
  );
}
