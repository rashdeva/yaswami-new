// Карточка организатора: профиль, фото сообщества, его события в каталоге, переход в диалог, история.
import { zodResolver } from '@hookform/resolvers/zod';
import type { Host, HostUpdateInput as Input, Wire } from '@yaswami/core';
import { collectedWhen, HostUpdateInput, INBOX_STAGES } from '@yaswami/core';
import { MessagesSquareIcon, Trash2Icon } from 'lucide-react';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { Confirm, UNDO_HINT } from '@/components/Confirm';
import { EntityLink, ExternalLink, TelegramLink } from '@/components/EntityLink';
import { AreaField, SaveBar, saveDirty, TextField } from '@/components/Fields';
import { History } from '@/components/History';
import { Failed, Hint, Loading, Page, Section } from '@/components/Page';
import { AspectRatio } from '@/components/ui/aspect-ratio';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item';
import { useCollectedEvents } from '@/hooks/useCollectedEvents';
import { useHost, useHostActions } from '@/hooks/useHosts';
import { useOverview } from '@/hooks/useOverview';
import { COLLECTED_LABELS, hostEvents } from '@/lib/catalog';

const values = (h: Wire<Host>): Input => ({ name: h.name, username: h.username, bio: h.bio, channel: h.channel, summary: h.summary });

export function HostScreen({ id, onOpen, onDeleted }: { id: string; onOpen: (conversation: string) => void; onDeleted: () => void }) {
  const { data: h, error } = useHost(id);
  const { update, remove } = useHostActions(id);
  const { data: catalog } = useCollectedEvents();
  const overview = useOverview();
  const initial = useMemo(() => h && values(h), [h]);
  const form = useForm({ resolver: zodResolver(HostUpdateInput), values: initial, resetOptions: { keepDirtyValues: true } });

  if (error) return <Page title="Организатор"><Failed error={error} /></Page>;
  if (!h) return <Page title="Организатор"><Loading rows={6} /></Page>;
  const row = overview?.hosts.find((r) => r.telegram_id === h.telegram_id);
  const events = hostEvents(h, catalog ?? []);

  return (
    <Page
      title={h.name}
      description={<>
        <TelegramLink username={h.username} /> · Telegram id {h.telegram_id}
        {h.user_id ? <> · в сервисе: <EntityLink entity="user" id={h.user_id}>карточка пользователя</EntityLink></> : ' · в сервис не входил'}
        {row && ` · предстоящих событий ${row.events}, записей ${row.signups}`}
      </>}
      actions={
        <>
          {row?.conversation_id && <Button size="sm" variant="outline" onClick={() => onOpen(row.conversation_id!)}><MessagesSquareIcon />Диалог · {INBOX_STAGES[row.stage!]}</Button>}
          <Confirm title={`Удалить профиль «${h.name}»?`} description={`Профиль и фото сообщества пропадут; события каталога останутся. Сборщик может собрать профиль заново. ${UNDO_HINT}`} onConfirm={() => remove(undefined, { onSuccess: onDeleted })}>
            <Button size="sm" variant="outline"><Trash2Icon />Удалить</Button>
          </Confirm>
        </>
      }
    >
      <Section title="Профиль">
        <form onSubmit={saveDirty(form, update)} className="flex flex-col gap-4">
          <FieldGroup>
            <div className="grid gap-4 md:grid-cols-3">
              <TextField form={form} name="name" label="Имя" />
              <TextField form={form} name="username" label="Username" hint="Без @" />
              <TextField form={form} name="channel" label="Канал" nullable hint="Без @" />
            </div>
            <AreaField form={form} name="bio" label="О себе (из Telegram)" nullable />
            <AreaField form={form} name="summary" label="Сводка" nullable rows={5} />
          </FieldGroup>
          <SaveBar form={form} />
        </form>
      </Section>

      <Section title={<>События в каталоге <Badge variant="secondary">{events.length}</Badge></>}>
        {events.length === 0 && <Hint>Не нашлось: события связываются с организатором по контакту для записи или по каналу.</Hint>}
        <ItemGroup className="gap-1">
          {events.map((e) => (
            <Item key={e.id} size="xs" variant="muted">
              <ItemContent>
                <ItemTitle><EntityLink entity="collected_event" id={e.id}>{e.title}</EntityLink></ItemTitle>
                <ItemDescription>{collectedWhen(e.starts_at)}</ItemDescription>
              </ItemContent>
              <ItemActions><Badge variant="secondary">{COLLECTED_LABELS[e.status]}</Badge></ItemActions>
            </Item>
          ))}
        </ItemGroup>
      </Section>

      {h.photos.length > 0 && (
        <Section title="Фото сообщества">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {h.photos.map((p) => (
              <ExternalLink key={p.url} href={p.source_url}>
                <AspectRatio ratio={1} className="overflow-hidden rounded-md bg-muted"><img className="size-full object-cover" src={p.url} alt="" loading="lazy" /></AspectRatio>
              </ExternalLink>
            ))}
          </div>
        </Section>
      )}

      <History entity="host" id={id} />
    </Page>
  );
}
