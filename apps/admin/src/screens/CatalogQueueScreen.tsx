// «Каталог» → «По одному»: ждущие решения идут очередью. Слева исходный анонс, справа извлечённые поля формой;
// поправил — одобрил или отклонил — следующее. Правка и решение уходят одним действием (тост «Отменить»).
import { zodResolver } from '@hookform/resolvers/zod';
import type { AdminCollectedEvent, CollectedUpdateInput as Input } from '@yaswami/core';
import { CollectedUpdateInput } from '@yaswami/core';
import { useForm } from 'react-hook-form';
import { Cover } from '@/components/Cover';
import { ExternalLink } from '@/components/EntityLink';
import { AreaField, DateTimeField, SelectField, TextField } from '@/components/Fields';
import { Hint, Loading, Nothing } from '@/components/Page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { ScrollArea } from '@/components/ui/scroll-area';
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
        <CardContent className="grid gap-5 lg:grid-cols-5">
          <div className="flex min-w-0 gap-3 lg:col-span-2">
            <Cover url={event.cover_url} className="w-24 flex-none self-start" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Hint>источник: {event.channel}</Hint>
              <ExternalLink href={event.source_url} icon>исходный анонс</ExternalLink>
              {event.source_text && (
                <ScrollArea className="h-96 rounded-md border">
                  <Hint><span className="block p-2.5 whitespace-pre-wrap">{event.source_text}</span></Hint>
                </ScrollArea>
              )}
            </div>
          </div>
          <FieldGroup className="grid content-start gap-3 sm:grid-cols-2 lg:col-span-3">
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
      <Hint>Ждут решения: <Badge>{left}</Badge></Hint>
      <QueueCard key={current.id} event={current} onSkip={() => skip(current.id)} onDecide={(input) => decide(current.id, input)} />
    </section>
  );
}
