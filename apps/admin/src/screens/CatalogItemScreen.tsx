// Карточка собранного события: модерация, поля анонса, обложка, ролик, записавшиеся, история.
import { zodResolver } from '@hookform/resolvers/zod';
import type { AdminCollectedEventView, CollectedUpdateInput as Input, Wire } from '@yaswami/core';
import { CollectedUpdateInput, collectedPath, OTHER_TOPIC, TOPIC_GUIDES } from '@yaswami/core';
import { ExternalLinkIcon, Trash2Icon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Confirm, UNDO_HINT } from '@/components/Confirm';
import { EntityLink } from '@/components/EntityLink';
import { AreaField, DateTimeField, ListField, SaveBar, saveDirty, SelectField, TextField, TriField } from '@/components/Fields';
import { History } from '@/components/History';
import { Failed, Loading, Page, Section } from '@/components/Page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FieldGroup, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input as TextInput } from '@/components/ui/input';
import { useCatalogActions, useCollectedEvent } from '@/hooks/useCollectedEvents';
import { COLLECTED_LABELS, contactOf } from '@/lib/catalog';
import { offsetOf } from '@/lib/form';

/** Значения формы из события. Контакты для записи сервер не отдаёт — видно только то, что в ссылке «Записаться». */
const values = (e: Wire<AdminCollectedEventView>): Input => ({
  title: e.title, description: e.description, starts_at: e.starts_at, ends_at: e.ends_at, place: e.place, address: e.address, price: e.price, tags: e.tags,
  ...contactOf(e), topic: e.topic, what_happens: e.what_happens ?? [], for_whom: e.for_whom ?? null, beginner_friendly: e.beginner_friendly ?? null,
  takeaway: e.takeaway ?? null,
});

export function CatalogItemScreen({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const { data: e, error } = useCollectedEvent(id);
  const { update, remove, setCover, requestVideo } = useCatalogActions();
  const initial = useMemo(() => e && values(e), [e]);
  const form = useForm({ resolver: zodResolver(CollectedUpdateInput), values: initial, resetOptions: { keepDirtyValues: true } });
  const [imageUrl, setImageUrl] = useState('');

  if (error) return <Page title="Событие каталога"><Failed error={error} /></Page>;
  if (!e) return <Page title="Событие каталога"><Loading rows={8} /></Page>;
  const zone = offsetOf(e.starts_at);
  const topics = [...new Set([...Object.keys(TOPIC_GUIDES), OTHER_TOPIC, ...(e.topic ? [e.topic] : [])])].map((t) => [t, t] as const);
  const moderate = (status: 'approved' | 'rejected') => update({ id, input: { status } });

  return (
    <Page
      title={<>{e.title} <Badge variant={e.status === 'pending' ? 'default' : 'secondary'}>{COLLECTED_LABELS[e.status]}</Badge></>}
      actions={
        <>
          {(e.status === 'pending' || e.status === 'rejected') && <Button size="sm" onClick={() => moderate('approved')}>Одобрить</Button>}
          {e.status !== 'rejected' && <Button size="sm" variant="outline" onClick={() => moderate('rejected')}>{e.status === 'pending' ? 'Отклонить' : 'Снять с публикации'}</Button>}
          <Confirm
            title={`Удалить «${e.title}»?`}
            description={`Событие пропадёт вместе с обложкой и записями. Повторный анонс создаст его заново — чтобы скрыть навсегда, лучше отклонить. ${UNDO_HINT}`}
            onConfirm={() => remove(id, { onSuccess: onDeleted })}
          >
            <Button size="sm" variant="outline"><Trash2Icon />Удалить</Button>
          </Confirm>
        </>
      }
    >
      <div className="flex flex-wrap gap-3 text-sm">
        <a className="inline-flex items-center gap-1 underline" href={e.source_url} target="_blank" rel="noreferrer"><ExternalLinkIcon className="size-3.5" />анонс в @{e.channel}</a>
        {/* Страница события — на сайте, вне админки: обычная ссылка, не маршрут. */}
        {e.status === 'published' && <a className="inline-flex items-center gap-1 underline" href={collectedPath(e.id)} target="_blank" rel="noreferrer"><ExternalLinkIcon className="size-3.5" />страница события</a>}
        {e.hosts?.map((h) => <span key={h.name} className="text-muted-foreground">организатор: {h.name}{h.confirmed ? ' (вошёл)' : ''}</span>)}
        {e.views != null && <span className="text-muted-foreground">просмотров {e.views}</span>}
      </div>

      <Section title="Поля анонса">
        <form onSubmit={saveDirty(form, (input: Input, cb) => update({ id, input }, cb))} className="flex flex-col gap-4">
          <FieldGroup>
            <TextField form={form} name="title" label="Название" />
            <div className="grid gap-4 md:grid-cols-2">
              <DateTimeField form={form} name="starts_at" label="Начало" zone={zone} hint={`Время города, смещение ${zone}`} />
              <DateTimeField form={form} name="ends_at" label="Конец" zone={zone} nullable />
              <TextField form={form} name="place" label="Место" nullable />
              <TextField form={form} name="address" label="Адрес" nullable />
              <TextField form={form} name="price" label="Цена" nullable />
              <SelectField form={form} name="topic" label="Тема" options={topics} />
            </div>
            <AreaField form={form} name="description" label="Описание" rows={6} />
            <ListField form={form} name="tags" label="Теги" by="comma" hint="Через запятую" />
            <FieldSet>
              <FieldLegend variant="label">Запись</FieldLegend>
              <p className="text-xs text-muted-foreground">Сервер не отдаёт контакты — показано то, что видно в ссылке «Записаться». Пустое поле не трогается, пока его не заполнить.</p>
              <div className="grid gap-4 md:grid-cols-3">
                <TextField form={form} name="telegram_username" label="Telegram организатора" nullable placeholder="username без @" />
                <TextField form={form} name="whatsapp_phone" label="WhatsApp" nullable />
                <TextField form={form} name="url" label="Ссылка на регистрацию" nullable type="url" />
              </div>
            </FieldSet>
            <FieldSet>
              <FieldLegend variant="label">Что это мне даст</FieldLegend>
              <div className="grid gap-4 md:grid-cols-3">
                <TextField form={form} name="for_whom" label="Для кого" nullable />
                <TextField form={form} name="takeaway" label="Что унесёт гость" nullable />
                <TriField form={form} name="beginner_friendly" label="Подходит новичкам" />
              </div>
              <ListField form={form} name="what_happens" label="Что будет, по шагам" by="line" hint="Шаг — на отдельной строке" />
            </FieldSet>
          </FieldGroup>
          <SaveBar form={form} />
        </form>
      </Section>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Обложка">
          <div className="flex gap-3">
            {e.cover_url
              ? <img className="aspect-9/16 w-28 flex-none rounded-lg bg-muted object-cover" src={e.cover_url} alt="" />
              : <div className="flex aspect-9/16 w-28 flex-none items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground">нет</div>}
            <div className="flex min-w-0 flex-col gap-2 text-sm">
              <Button size="sm" variant="outline" onClick={() => setCover({ id })}>Оставить фото анонса</Button>
              <form className="flex flex-col gap-2" onSubmit={(ev) => (ev.preventDefault(), imageUrl && setCover({ id, image_url: imageUrl.trim() }, { onSuccess: () => setImageUrl('') }))}>
                <TextInput value={imageUrl} onChange={(ev) => setImageUrl(ev.target.value)} placeholder="https://files-cdn.x.ai/…" type="url" />
                <Button size="sm" type="submit" disabled={!imageUrl}>Заменить нарисованной</Button>
              </form>
              <p className="text-xs text-muted-foreground">Картинка — только из хранилища xAI. Решение можно отменить в «Журнале».</p>
            </div>
          </div>
        </Section>

        <Section title="Ролик">
          {e.video_url
            ? <video className="aspect-9/16 w-40 rounded-lg bg-muted" src={e.video_url} controls preload="metadata" />
            : (
              <div className="flex flex-col items-start gap-2 text-sm">
                <p className="text-muted-foreground">Ролика нет. Его делает иллюстратор после одобрения.</p>
                <Confirm
                  title="Заказать ролик?" action="Заказать" destructive={false}
                  description="Генерация ролика стоит денег и не отменяется. Ролик появится здесь через несколько минут."
                  onConfirm={() => requestVideo(id)}
                >
                  <Button size="sm" variant="outline" disabled={e.status === 'pending' || e.status === 'rejected'}>Заказать ролик</Button>
                </Confirm>
              </div>
            )}
        </Section>
      </div>

      <Section title={<>Записались <Badge variant="secondary">{e.signups.length}</Badge></>}>
        {e.signups.length === 0 && <p className="text-xs text-muted-foreground">Никто ещё не нажал «Записаться».</p>}
        <ul className="flex flex-col gap-1 text-sm">
          {e.signups.map((s) => (
            <li key={s.id}>
              <EntityLink entity="user" id={s.id}>{s.first_name}</EntityLink> {s.username && <span className="text-xs text-muted-foreground">@{s.username}</span>}{' '}
              <span className="text-xs text-muted-foreground">{new Date(s.at).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            </li>
          ))}
        </ul>
      </Section>

      <History entity="collected_event" id={id} />
    </Page>
  );
}
