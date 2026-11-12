// Карточка собранного события: модерация, поля анонса, обложка, ролик, записавшиеся, история.
import { zodResolver } from '@hookform/resolvers/zod';
import type { AdminCollectedEventView, CollectedUpdateInput as Input, Wire } from '@yaswami/core';
import { CollectedUpdateInput, collectedPath } from '@yaswami/core';
import { Trash2Icon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Confirm, UNDO_HINT } from '@/components/Confirm';
import { Cover } from '@/components/Cover';
import { EntityLink, ExternalLink, TelegramLink } from '@/components/EntityLink';
import { AreaField, DateTimeField, ListField, SaveBar, saveDirty, SelectField, TextField, TriField } from '@/components/Fields';
import { History } from '@/components/History';
import { Failed, Hint, Loading, Page, Section } from '@/components/Page';
import { AspectRatio } from '@/components/ui/aspect-ratio';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FieldGroup, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input as TextInput } from '@/components/ui/input';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item';
import { useCatalogActions, useCollectedEvent } from '@/hooks/useCollectedEvents';
import { COLLECTED_LABELS, topicOptions } from '@/lib/catalog';
import { offsetOf } from '@/lib/form';

/** Значения формы из события. */
const values = (e: Wire<AdminCollectedEventView>): Input => ({
  title: e.title, description: e.description, starts_at: e.starts_at, ends_at: e.ends_at, place: e.place, address: e.address, price: e.price, tags: e.tags,
  telegram_username: e.telegram_username, whatsapp_phone: e.whatsapp_phone, url: e.url, topic: e.topic, what_happens: e.what_happens ?? [], for_whom: e.for_whom ?? null, beginner_friendly: e.beginner_friendly ?? null,
  takeaway: e.takeaway ?? null,
});

export function CatalogItemScreen({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const { data: e, error } = useCollectedEvent(id);
  const { update, remove, setCover, requestVideo, redo } = useCatalogActions();
  const initial = useMemo(() => e && values(e), [e]);
  const form = useForm({ resolver: zodResolver(CollectedUpdateInput), values: initial, resetOptions: { keepDirtyValues: true } });
  const [imageUrl, setImageUrl] = useState('');

  if (error) return <Page title="Событие каталога"><Failed error={error} /></Page>;
  if (!e) return <Page title="Событие каталога"><Loading rows={8} /></Page>;
  const zone = offsetOf(e.starts_at);
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
      <div className="flex flex-wrap items-center gap-3">
        <ExternalLink href={e.source_url} icon>анонс в @{e.channel}</ExternalLink>
        {/* Страница события — на сайте, вне админки: обычная ссылка, не маршрут. */}
        {e.status === 'published' && <ExternalLink href={collectedPath(e.id)} icon>страница события</ExternalLink>}
        {e.hosts?.map((h) => <Badge key={h.name} variant="outline">организатор: {h.name}{h.confirmed ? ' (вошёл)' : ''}</Badge>)}
        {e.views != null && <Badge variant="secondary">просмотров {e.views}</Badge>}
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
              <SelectField form={form} name="topic" label="Тема" options={topicOptions(e.topic)} />
            </div>
            <AreaField form={form} name="description" label="Описание" rows={6} />
            <ListField form={form} name="tags" label="Теги" by="comma" hint="Через запятую" />
            <FieldSet>
              <FieldLegend variant="label">Запись</FieldLegend>
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
            <Cover url={e.cover_url} className="w-28 flex-none" />
            <div className="flex min-w-0 flex-col gap-2">
              <Button size="sm" variant="outline" onClick={() => setCover({ id })}>Оставить фото анонса</Button>
              <form className="flex flex-col gap-2" onSubmit={(ev) => (ev.preventDefault(), imageUrl && setCover({ id, image_url: imageUrl.trim() }, { onSuccess: () => setImageUrl('') }))}>
                <TextInput value={imageUrl} onChange={(ev) => setImageUrl(ev.target.value)} placeholder="https://files-cdn.x.ai/…" type="url" />
                <Button size="sm" type="submit" disabled={!imageUrl}>Заменить нарисованной</Button>
              </form>
              <Hint>Картинка — только из хранилища xAI. Решение можно отменить в «Журнале».</Hint>
            </div>
          </div>
        </Section>

        <Section title="Ролик">
          {e.video_url
            ? (
              <div className="flex flex-col items-start gap-2">
                <div className="w-40"><AspectRatio ratio={9 / 16} className="overflow-hidden rounded-md bg-muted"><video className="size-full" src={e.video_url} controls preload="metadata" /></AspectRatio></div>
                <Confirm
                  title="Перерисовать обложку и ролик?" action="Перерисовать"
                  description="Нарисованная обложка и ролик удалятся, иллюстратор сделает новые минут через 20–30 — это стоит денег. Пока он не взялся, действие можно отменить в «Журнале»."
                  onConfirm={() => redo(id)}
                >
                  <Button size="sm" variant="outline">Перерисовать обложку и ролик</Button>
                </Confirm>
              </div>
            )
            : (
              <div className="flex flex-col items-start gap-2">
                <Hint>Ролика нет. Его делает иллюстратор после одобрения.</Hint>
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
        {e.signups.length === 0 && <Hint>Никто ещё не нажал «Записаться».</Hint>}
        <ItemGroup className="gap-1">
          {e.signups.map((s) => (
            <Item key={s.id} size="xs" variant="muted">
              <ItemContent>
                <ItemTitle><EntityLink entity="user" id={s.id}>{s.first_name}</EntityLink></ItemTitle>
                {s.username && <ItemDescription><TelegramLink username={s.username} /></ItemDescription>}
              </ItemContent>
              <ItemActions><ItemDescription>{new Date(s.at).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</ItemDescription></ItemActions>
            </Item>
          ))}
        </ItemGroup>
      </Section>

      <History entity="collected_event" id={id} />
    </Page>
  );
}
