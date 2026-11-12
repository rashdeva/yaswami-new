// Карточка пользователя: поля, его события и ответы, записи в каталоге, аудитория, токены, удаление, история.
import { zodResolver } from '@hookform/resolvers/zod';
import type { User, UserUpdateInput as Input } from '@yaswami/core';
import { UserUpdateInput } from '@yaswami/core';
import { KeyRoundIcon, Trash2Icon } from 'lucide-react';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { Confirm, UNDO_HINT } from '@/components/Confirm';
import { EntityLink } from '@/components/EntityLink';
import { SaveBar, saveDirty, TextField } from '@/components/Fields';
import { History } from '@/components/History';
import { Failed, Loading, Page, Section } from '@/components/Page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
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
      title={<>{u.first_name} {u.username && <span className="text-sm font-normal text-muted-foreground">@{u.username}</span>}</>}
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
      <p className="text-sm text-muted-foreground">Telegram id {u.id}</p>

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
        {events.length === 0 && <p className="text-xs text-muted-foreground">Своих событий нет.</p>}
        <ul className="flex flex-col gap-1 text-sm">
          {events.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2">
              <EntityLink entity="event" id={e.id}>{e.name}</EntityLink>
              <span className="text-xs text-muted-foreground">{wallParts(e.start_at, e.timezone).join(' ')}</span>
              <Badge variant="secondary">{EVENT_STATUS_LABELS[e.status]}</Badge>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={<>Ответы на события <Badge variant="secondary">{guests.length}</Badge></>}>
        {guests.length === 0 && <p className="text-xs text-muted-foreground">Ни на одно событие не отвечал.</p>}
        <ul className="flex flex-col gap-1 text-sm">
          {guests.map((g) => (
            <li key={g.event_id} className="flex flex-wrap items-center gap-2">
              <EntityLink entity="event" id={g.event_id}>{g.event_name}</EntityLink>
              <Badge variant="outline">{APPROVAL_LABELS[g.approval_status]}</Badge>
              {g.plus_ones > 0 && <span className="text-xs text-muted-foreground">+{g.plus_ones}</span>}
            </li>
          ))}
        </ul>
      </Section>

      {collected_signups.length > 0 && (
        <Section title={<>Записался в каталоге <Badge variant="secondary">{collected_signups.length}</Badge></>}>
          <ul className="flex flex-col gap-1 text-sm">
            {collected_signups.map((c) => <li key={c}><EntityLink entity="collected_event" id={c}>{c}</EntityLink></li>)}
          </ul>
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
      <ul className="flex flex-col divide-y text-sm">
        {data.map((c) => (
          <li key={c.id} className="flex items-center gap-2 py-1">
            <EntityLink entity="user" id={c.user_id}>{c.first_name}</EntityLink> {c.username && <span className="text-xs text-muted-foreground">@{c.username}</span>}
            <Confirm title={`Убрать ${c.first_name} из аудитории?`} description={`Человек вернётся в аудиторию, если снова зайдёт на событие. ${UNDO_HINT}`} action="Убрать" onConfirm={() => remove(c.id)}>
              <Button size="icon-sm" variant="ghost" className="ml-auto" aria-label="Убрать"><Trash2Icon /></Button>
            </Confirm>
          </li>
        ))}
      </ul>
    </Section>
  );
}
