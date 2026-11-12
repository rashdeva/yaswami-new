// Карточка пользователя: поля, его события и ответы, записи в каталоге, аудитория, токены, удаление, история.
import { zodResolver } from '@hookform/resolvers/zod';
import type { User, UserUpdateInput as Input } from '@yaswami/core';
import { UserUpdateInput } from '@yaswami/core';
import { KeyRoundIcon, Trash2Icon } from 'lucide-react';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { Confirm, UNDO_HINT } from '@/components/Confirm';
import { EntityLink, PostHogLink, TelegramLink } from '@/components/EntityLink';
import { SaveBar, saveDirty, TextField } from '@/components/Fields';
import { History } from '@/components/History';
import { Failed, Hint, Loading, Page, Section } from '@/components/Page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item';
import { useContacts, useUser, useUserActions } from '@/hooks/useUsers';
import { APPROVAL_LABELS, EVENT_STATUS_LABELS } from '@/lib/catalog';
import { wallParts } from '@/lib/form';

const values = (u: User): Input => ({ first_name: u.first_name, username: u.username, lang: u.lang, timezone: u.timezone });

export function UserScreen({ id, onDeleted }: { id: number; onDeleted: () => void }) {
  const { data, error } = useUser(id);
  const act = useUserActions(id);
  const initial = useMemo(() => data && values(data.user), [data]);
  const form = useForm({ resolver: zodResolver(UserUpdateInput), values: initial, resetOptions: { keepDirtyValues: true } });

  if (error) return <Page title="Пользователь"><Failed error={error} /></Page>;
  if (!data) return <Page title="Пользователь"><Loading rows={6} /></Page>;
  const { user: u, events, guests, collected_signups } = data;

  return (
    <Page
      title={u.first_name}
      description={<>{u.username && <><TelegramLink username={u.username} /> · </>}Telegram id {u.id} · <PostHogLink userId={u.id} /></>}
      actions={
        <>
          <Confirm
            title="Отозвать токены?" action="Отозвать"
            description="Человека выкинет со всех устройств на сайте, токены его агентов перестанут работать. Это не отменить: войти он сможет заново сам."
            onConfirm={() => act.revokeTokens(undefined)}
          >
            <Button size="sm" variant="outline"><KeyRoundIcon />Отозвать токены</Button>
          </Confirm>
          <Confirm
            title={`Удалить ${u.first_name}?`}
            description={`Пропадут его ответы на события, записи в каталоге и контакты. Пользователя со своими событиями удалить нельзя. ${UNDO_HINT}`}
            onConfirm={() => act.remove(undefined, { onSuccess: onDeleted })}
          >
            <Button size="sm" variant="outline"><Trash2Icon />Удалить</Button>
          </Confirm>
        </>
      }
    >
      <Section title="Поля">
        <form onSubmit={saveDirty(form, act.update)} className="flex flex-col gap-4">
          <FieldGroup>
            <div className="grid gap-4 md:grid-cols-2">
              <TextField form={form} name="first_name" label="Имя" />
              <TextField form={form} name="username" label="Username" nullable hint="Без @" />
              <TextField form={form} name="lang" label="Язык" hint="ru, en…" />
              <TextField form={form} name="timezone" label="Часовой пояс" hint="IANA, например Asia/Tbilisi" />
            </div>
          </FieldGroup>
          <SaveBar form={form} />
        </form>
      </Section>

      <Section title={<>Его события <Badge variant="secondary">{events.length}</Badge></>}>
        {events.length === 0 && <Hint>Своих событий нет.</Hint>}
        <ItemGroup className="gap-1">
          {events.map((e) => (
            <Item key={e.id} size="xs" variant="muted">
              <ItemContent>
                <ItemTitle><EntityLink entity="event" id={e.id}>{e.name}</EntityLink></ItemTitle>
                <ItemDescription>{wallParts(e.start_at, e.timezone).join(' ')}</ItemDescription>
              </ItemContent>
              <ItemActions><Badge variant="secondary">{EVENT_STATUS_LABELS[e.status]}</Badge></ItemActions>
            </Item>
          ))}
        </ItemGroup>
      </Section>

      <Section title={<>Ответы на события <Badge variant="secondary">{guests.length}</Badge></>}>
        {guests.length === 0 && <Hint>Ни на одно событие не отвечал.</Hint>}
        <ItemGroup className="gap-1">
          {guests.map((g) => (
            <Item key={g.event_id} size="xs" variant="muted">
              <ItemContent><ItemTitle><EntityLink entity="event" id={g.event_id}>{g.event_name}</EntityLink></ItemTitle></ItemContent>
              <ItemActions>
                {g.plus_ones > 0 && <Badge variant="secondary">+{g.plus_ones}</Badge>}
                <Badge variant="outline">{APPROVAL_LABELS[g.approval_status]}</Badge>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      </Section>

      {collected_signups.length > 0 && (
        <Section title={<>Записался в каталоге <Badge variant="secondary">{collected_signups.length}</Badge></>}>
          <ItemGroup className="gap-1">
            {collected_signups.map((c) => (
              <Item key={c} size="xs" variant="muted"><ItemContent><ItemTitle><EntityLink entity="collected_event" id={c}>{c}</EntityLink></ItemTitle></ItemContent></Item>
            ))}
          </ItemGroup>
        </Section>
      )}

      <Audience id={id} remove={act.removeContact} />
      <History entity="user" id={id} />
    </Page>
  );
}

/** Аудитория — если он организатор: люди, которые заходили на его события или отвечали на них. */
function Audience({ id, remove }: { id: number; remove: (contact: string) => void }) {
  const { data } = useContacts(id);
  if (!data?.length) return null;
  return (
    <Section title={<>Аудитория <Badge variant="secondary">{data.length}</Badge></>}>
      <ItemGroup className="gap-1">
        {data.map((c) => (
          <Item key={c.id} size="xs" variant="muted">
            <ItemContent>
              <ItemTitle><EntityLink entity="user" id={c.user_id}>{c.first_name}</EntityLink></ItemTitle>
              {c.username && <ItemDescription><TelegramLink username={c.username} /></ItemDescription>}
            </ItemContent>
            <ItemActions>
              <Confirm title={`Убрать ${c.first_name} из аудитории?`} description={`Человек вернётся в аудиторию, если снова зайдёт на событие. ${UNDO_HINT}`} action="Убрать" onConfirm={() => remove(c.id)}>
                <Button size="icon-sm" variant="ghost" aria-label="Убрать"><Trash2Icon /></Button>
              </Confirm>
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
    </Section>
  );
}
