// «События»: модерация собранных событий. Новые идут очередью по одному: поправил поля — одобрил или отклонил — следующее.
// Одобренное проходит обработку (обложка и ролик) и выходит в ленту; опубликованное можно снять или удалить.
import { useState } from 'react';
import type { AdminCollectedEvent, CollectedStatus, Wire } from '@yaswami/core';
import { collectedPath, collectedWhen, OTHER_TOPIC, TOPIC_GUIDES } from '@yaswami/core';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { useCollectedEvents, useModeration, useModerationQueue } from '@/hooks/useCollectedEvents';
import type { Draft } from '@/lib/collected';
import { changesOf, draftOf } from '@/lib/collected';

type Item = Wire<AdminCollectedEvent>;

const GROUPS: { status: CollectedStatus; title: string; hint: string }[] = [
  { status: 'approved', title: 'Обрабатываются', hint: 'Одобрены: иллюстратор делает обложку и ролик, после этого событие само выйдет в ленту.' },
  { status: 'published', title: 'В ленте', hint: 'Видны всем. Событие можно снять с публикации или удалить.' },
  { status: 'rejected', title: 'Отклонены', hint: 'Не выводятся нигде. Остаются в базе, чтобы повторный анонс не создал событие заново.' },
];

const TOPICS = [...Object.entries(TOPIC_GUIDES).map(([key, g]) => [key, `${g.emoji} ${key}`]), [OTHER_TOPIC, OTHER_TOPIC]];

const Cover = ({ url }: { url?: string | null }) => url
  ? <img className="aspect-9/16 w-24 flex-none self-start rounded-lg bg-muted object-cover" src={url} alt="" loading="lazy" />
  : <div className="flex aspect-9/16 w-24 flex-none self-start items-center justify-center rounded-lg bg-muted text-[11px] text-muted-foreground">нет фото</div>;

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={`flex flex-col gap-1.5 ${wide ? 'sm:col-span-2' : ''}`}><span className="text-xs text-muted-foreground">{label}</span>{children}</label>;
}

/** Одно событие из очереди: слева исходный анонс, справа то, что из него извлёк ИИ, — сразу формой. */
function QueueCard({ event, onDecide, onSkip }: { event: Item; onDecide: (draft: Draft | null) => void; onSkip: () => void }) {
  const [draft, setDraft] = useState(() => draftOf(event));
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setDraft({ ...draft, [k]: e.target.value });
  const edited = Object.keys(changesOf(event, draft)).length > 0;
  return (
    <form onSubmit={(e) => { e.preventDefault(); onDecide(draft); }}>
      <Card>
        <CardContent className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="flex min-w-0 gap-3">
            <Cover url={event.cover_url} />
            <div className="flex min-w-0 flex-col gap-1.5 text-xs">
              <div className="text-muted-foreground">источник: {event.channel}</div>
              <a className="underline" href={event.source_url} target="_blank" rel="noreferrer">исходный анонс</a>
              {event.source_text && <p className="max-h-[28rem] overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-2.5">{event.source_text}</p>}
            </div>
          </div>
          <div className="grid content-start gap-3 sm:grid-cols-2">
            <Field label="Название" wide><Input required value={draft.title} onChange={set('title')} /></Field>
            <Field label="Начало"><Input required type="datetime-local" value={draft.starts_at} onChange={set('starts_at')} /></Field>
            <Field label="Конец"><Input type="datetime-local" value={draft.ends_at} onChange={set('ends_at')} /></Field>
            <Field label="Место"><Input value={draft.place} onChange={set('place')} /></Field>
            <Field label="Адрес"><Input value={draft.address} onChange={set('address')} /></Field>
            <Field label="Цена"><Input value={draft.price} onChange={set('price')} /></Field>
            <Field label="Тема">
              <NativeSelect className="w-full" value={draft.topic} onChange={set('topic')}>
                {!event.topic && <NativeSelectOption value="">—</NativeSelectOption>}
                {TOPICS.map(([key, label]) => <NativeSelectOption key={key} value={key}>{label}</NativeSelectOption>)}
              </NativeSelect>
            </Field>
            <Field label="Контакт в Telegram"><Input placeholder="username" value={draft.telegram_username} onChange={set('telegram_username')} /></Field>
            <Field label="WhatsApp"><Input value={draft.whatsapp_phone} onChange={set('whatsapp_phone')} /></Field>
            <Field label="Ссылка для записи" wide><Input type="url" value={draft.url} onChange={set('url')} /></Field>
            <Field label="Описание" wide><Textarea className="min-h-40" value={draft.description} onChange={set('description')} /></Field>
          </div>
        </CardContent>
      </Card>
      <div className="sticky bottom-0 mt-3 flex items-center gap-2 border-t bg-background py-3">
        <Button type="button" variant="outline" onClick={() => onDecide(null)}>Отклонить</Button>
        <Button type="button" variant="ghost" onClick={onSkip}>Пропустить</Button>
        <Button type="submit" className="ml-auto">{edited ? 'Сохранить и одобрить' : 'Одобрить'}</Button>
      </div>
    </form>
  );
}

function Queue() {
  const { current, left, decide, skip } = useModerationQueue();
  if (left === undefined) return <p className="text-xs text-muted-foreground">Загружаю…</p>;
  return (
    <section className="mt-4">
      <h3 className="flex items-center gap-2 text-sm font-medium">Ждут решения <Badge>{left}</Badge></h3>
      <p className="mb-2 text-xs text-muted-foreground">
        {current ? 'Сборщик разобрал анонс. Сверьте поля с текстом, поправьте, если нужно, и решите. В ленте события нет, пока вы его не одобрите.' : 'Новых событий нет.'}
      </p>
      {current && (
        <QueueCard
          key={current.id} event={current} onSkip={() => skip(current.id)}
          // Отклоняем без правок: поля отклонённого никто не увидит.
          onDecide={(draft) => decide(current.id, draft ? { ...changesOf(current, draft), status: 'approved' } : { status: 'rejected' })}
        />
      )}
    </section>
  );
}

export function EventsScreen() {
  const items = useCollectedEvents();
  const { update, remove, redo } = useModeration();

  const card = (e: Item) => (
    <Card key={e.id} size="sm">
      <CardContent className="flex items-start gap-3">
        <Cover url={e.cover_url} />
        <div className="flex min-w-0 flex-col gap-1.5">
          <strong>{e.title}</strong>
          <div className="text-xs text-muted-foreground">{[collectedWhen(e.starts_at), e.place, e.price].filter(Boolean).join(' · ')}</div>
          <div className="text-xs text-muted-foreground">{[e.topic, `источник: ${e.channel}`, e.video_url && 'есть ролик'].filter(Boolean).join(' · ')}</div>
          {e.description && <p className="line-clamp-4 text-xs whitespace-pre-wrap">{e.description}</p>}
          <div className="flex flex-wrap gap-3 text-xs">
            <a className="underline" href={e.source_url} target="_blank" rel="noreferrer">исходный анонс</a>
            {/* Страница события — на сайте, вне админки: обычная ссылка, не маршрут. */}
            {e.status === 'published' && <a className="underline" href={collectedPath(e.id)} target="_blank" rel="noreferrer">страница события</a>}
          </div>
          <div className="flex flex-wrap gap-2">
            {e.status === 'rejected'
              ? <Button size="sm" onClick={() => update({ id: e.id, input: { status: 'approved' } })}>Одобрить</Button>
              : <Button size="sm" variant="outline" onClick={() => update({ id: e.id, input: { status: 'rejected' } })}>Снять с публикации</Button>}
            {e.video_url && (
              <Button size="sm" variant="outline" onClick={() => confirm(`Перерисовать обложку и ролик «${e.title}»? Новые появятся минут через 20–30.`) && redo(e.id)}>Перерисовать</Button>
            )}
            <Button size="sm" variant="outline" onClick={() => confirm(`Удалить «${e.title}» совсем? Повторный анонс создаст событие заново.`) && remove(e.id)}>Удалить</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="h-full overflow-y-auto p-5 pb-16">
      <h2 className="font-medium">События</h2>
      <Queue />
      {items && GROUPS.map(({ status, title, hint }) => {
        const list = items.filter((e) => e.status === status);
        if (!list.length) return null;
        return (
          <section key={status} className="mt-8">
            <h3 className="flex items-center gap-2 text-sm font-medium">{title} <Badge>{list.length}</Badge></h3>
            <p className="mb-2 text-xs text-muted-foreground">{hint}</p>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{list.map(card)}</div>
          </section>
        );
      })}
    </div>
  );
}
