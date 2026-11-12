// «Каталог» → «По одному»: ждущие решения идут очередью. Слева исходный анонс, справа извлечённые поля формой;
// поправил — одобрил или отклонил — следующее. Правка и решение уходят одним действием (тост «Отменить»).
import { zodResolver } from '@hookform/resolvers/zod';
import type { AdminCollectedEvent, CollectedUpdateInput as Input } from '@yaswami/core';
import { CollectedUpdateInput } from '@yaswami/core';
import { useForm } from 'react-hook-form';
import { AreaField, DateTimeField, SelectField, TextField } from '@/components/Fields';
import { Loading, Nothing } from '@/components/Page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { useModerationQueue } from '@/hooks/useCollectedEvents';
import { topicOptions } from '@/lib/catalog';
import { offsetOf, pickDirty } from '@/lib/form';

/** Поля, которые модератор сверяет с анонсом перед решением. */
const values = (e: AdminCollectedEvent): Input => ({
  title: e.title, starts_at: e.starts_at, ends_at: e.ends_at, place: e.place, address: e.address, price: e.price, topic: e.topic,
  telegram_username: e.telegram_username, whatsapp_phone: e.whatsapp_phone, url: e.url, description: e.description,
});

function QueueCard({ event, onDecide, onSkip }: { event: AdminCollectedEvent; onDecide: (input: Input) => void; onSkip: () => void }) {
  const form = useForm({ resolver: zodResolver(CollectedUpdateInput), defaultValues: values(event) });
  const zone = offsetOf(event.starts_at);
  const approve = form.handleSubmit((v) => onDecide({ ...pickDirty(v, form.formState.dirtyFields as Record<string, unknown>), status: 'approved' }));
  return (
    <form onSubmit={approve}>
      <Card>
        <CardContent className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="flex min-w-0 gap-3">
            {event.cover_url
              ? <img className="aspect-9/16 w-24 flex-none self-start rounded-lg bg-muted object-cover" src={event.cover_url} alt="" loading="lazy" />
              : <div className="flex aspect-9/16 w-24 flex-none items-center justify-center self-start rounded-lg bg-muted text-[11px] text-muted-foreground">нет фото</div>}
            <div className="flex min-w-0 flex-col gap-1.5 text-xs">
              <div className="text-muted-foreground">источник: {event.channel}</div>
              <a className="underline" href={event.source_url} target="_blank" rel="noreferrer">исходный анонс</a>
              {event.source_text && <p className="max-h-[28rem] overflow-y-auto rounded-md bg-muted p-2.5 whitespace-pre-wrap">{event.source_text}</p>}
            </div>
          </div>
          <FieldGroup className="grid content-start gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><TextField form={form} name="title" label="Название" /></div>
            <DateTimeField form={form} name="starts_at" label="Начало" zone={zone} />
            <DateTimeField form={form} name="ends_at" label="Конец" zone={zone} nullable />
            <TextField form={form} name="place" label="Место" nullable />
            <TextField form={form} name="address" label="Адрес" nullable />
            <TextField form={form} name="price" label="Цена" nullable />
            <SelectField form={form} name="topic" label="Тема" options={topicOptions(event.topic)} />
            <TextField form={form} name="telegram_username" label="Контакт в Telegram" nullable placeholder="username" />
            <TextField form={form} name="whatsapp_phone" label="WhatsApp" nullable />
            <div className="sm:col-span-2"><TextField form={form} name="url" label="Ссылка для записи" nullable type="url" /></div>
            <div className="sm:col-span-2"><AreaField form={form} name="description" label="Описание" rows={8} /></div>
          </FieldGroup>
        </CardContent>
      </Card>
      <div className="sticky bottom-0 mt-3 flex items-center gap-2 border-t bg-background py-3">
        {/* Отклоняем без правок: поля отклонённого никто не увидит. */}
        <Button type="button" variant="outline" onClick={() => onDecide({ status: 'rejected' })}>Отклонить</Button>
        <Button type="button" variant="ghost" onClick={onSkip}>Пропустить</Button>
        <Button type="submit" className="ml-auto">{form.formState.isDirty ? 'Сохранить и одобрить' : 'Одобрить'}</Button>
      </div>
    </form>
  );
}

export function CatalogQueueScreen() {
  const { current, left, decide, skip } = useModerationQueue();
  if (left === undefined) return <Loading rows={6} />;
  if (!current) return <Nothing title="Новых событий нет" />;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-2 text-sm font-medium">Ждут решения <Badge>{left}</Badge></h3>
      <QueueCard key={current.id} event={current} onSkip={() => skip(current.id)} onDecide={(input) => decide(current.id, input)} />
    </section>
  );
}
