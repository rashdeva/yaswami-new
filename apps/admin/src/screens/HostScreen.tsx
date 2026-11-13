// Карточка организатора: профиль, фото сообщества, его события в каталоге, переход в диалог, история.
import { zodResolver } from '@hookform/resolvers/zod';
import type { Host, HostUpdateInput as Input, Wire } from '@yaswami/core';
import { collectedWhen, HostUpdateInput, INBOX_STAGES, OTHER_TOPIC, TOPIC_GUIDES } from '@yaswami/core';
import { BanIcon, CheckIcon, MessagesSquareIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useMemo } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { CityField } from '@/components/City';
import { Confirm, UNDO_HINT } from '@/components/Confirm';
import { EntityLink, ExternalLink, TelegramLink } from '@/components/EntityLink';
import { AreaField, SaveBar, saveDirty, SelectField, showIssues, TextField } from '@/components/Fields';
import { History } from '@/components/History';
import { Failed, Hint, Loading, Page, Section } from '@/components/Page';
import { AspectRatio } from '@/components/ui/aspect-ratio';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { Separator } from '@/components/ui/separator';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item';
import { useCollectedEvents } from '@/hooks/useCollectedEvents';
import { useHost, useHostActions } from '@/hooks/useHosts';
import { useOverview } from '@/hooks/useOverview';
import { COLLECTED_LABELS, HOST_LABELS, hostEvents } from '@/lib/catalog';

const values = (h: Wire<Host>): Input => ({ name: h.name, city_id: h.city_id, username: h.username, bio: h.bio, channel: h.channel, summary: h.summary });

const TOPIC_OPTIONS = [...Object.keys(TOPIC_GUIDES), OTHER_TOPIC].map((t) => [t, t] as const);
const PracticesInput = HostUpdateInput.required({ practices: true }).pick({ practices: true });

export function HostScreen({ id, onOpen, onDeleted }: { id: string; onOpen: (conversation: string) => void; onDeleted: () => void }) {
  const { data: h, error } = useHost(id);
  const { update, remove } = useHostActions(id);
  const { data: catalog } = useCollectedEvents();
  const overview = useOverview();
  const initial = useMemo(() => h && values(h), [h]);
  const form = useForm({ resolver: zodResolver(HostUpdateInput), values: initial, resetOptions: { keepDirtyValues: true } });
  // Услуги — отдельной формой: список уходит целиком, а не по изменённым полям, как профиль.
  const listed = useMemo(() => h && { practices: h.practices }, [h]);
  const practicesForm = useForm({ resolver: zodResolver(PracticesInput), values: listed });
  const practices = useFieldArray({ control: practicesForm.control, name: 'practices' });

  if (error) return <Page title="Организатор"><Failed error={error} /></Page>;
  if (!h) return <Page title="Организатор"><Loading rows={6} /></Page>;
  const row = overview?.hosts.find((r) => r.username === h.username);
  const events = hostEvents(h, catalog ?? []);

  return (
    <Page
      title={<>{h.name} <Badge variant={h.status === 'published' ? 'default' : 'secondary'}>{HOST_LABELS[h.status]}</Badge></>}
      description={<>
        <TelegramLink username={h.username} /> · {h.telegram_id ? `Telegram id ${h.telegram_id}` : h.status === 'pending' ? 'добавлен по username: сборщик проверит его в Telegram и заполнит профиль на следующем проходе' : 'сборщик не нашёл его в Telegram; исправьте username и верните «Ждёт решения» — проверит снова'}
        {h.user_id ? <> · в сервисе: <EntityLink entity="user" id={h.user_id}>карточка пользователя</EntityLink></> : ' · в сервис не входил'}
        {row && ` · предстоящих событий ${row.events}, записей ${row.signups}`}
      </>}
      actions={
        <>
          {h.status !== 'published' && <Button size="sm" onClick={() => update({ status: 'published' })}><CheckIcon />Опубликовать</Button>}
          {h.status !== 'rejected' && <Button size="sm" variant="outline" onClick={() => update({ status: 'rejected' })}><BanIcon />Отклонить</Button>}
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
            <div className="grid gap-4 md:grid-cols-2">
              <TextField form={form} name="name" label="Имя" />
              <CityField form={form} />
              <TextField form={form} name="username" label="Username" hint="Без @" />
              <TextField form={form} name="channel" label="Канал" nullable hint="Без @" />
            </div>
            <AreaField form={form} name="bio" label="О себе (из Telegram)" nullable />
            <AreaField form={form} name="summary" label="Сводка" nullable rows={5} />
          </FieldGroup>
          <SaveBar form={form} />
        </form>
      </Section>

      <Section title={<>Услуги <Badge variant="secondary">{h.practices.length}</Badge></>} description="Что мастер ведёт без даты. Во вкладке «Услуги» видны только услуги из наших тем и только у опубликованного мастера; «другое» остаётся здесь.">
        {h.offer_url && <Hint>Из сообщения: <ExternalLink href={h.offer_url}>{h.offer_url.replace('https://', '')}</ExternalLink>. Сверь, что это сам мастер и его занятия.</Hint>}
        <form onSubmit={practicesForm.handleSubmit((v) => update({ practices: v.practices }, { onSuccess: () => practicesForm.reset(v), onError: (e) => showIssues(practicesForm, e) }))} className="flex flex-col gap-4">
          {practices.fields.length === 0 && <Hint>Пусто: организатор найден по событиям, а не по самопредставлению.</Hint>}
          {practices.fields.map((f, i) => (
            <FieldGroup key={f.id}>
              {i > 0 && <Separator />}
              <div className="grid items-end gap-4 md:grid-cols-[2fr_1fr_1fr_auto]">
                <TextField form={practicesForm} name={`practices.${i}.title`} label="Название" />
                <SelectField form={practicesForm} name={`practices.${i}.topic`} label="Тема" options={TOPIC_OPTIONS} />
                <TextField form={practicesForm} name={`practices.${i}.price`} label="Цена" nullable placeholder="по запросу" />
                <Button type="button" variant="outline" size="icon" aria-label="Убрать услугу" onClick={() => practices.remove(i)}><Trash2Icon /></Button>
              </div>
              <TextField form={practicesForm} name={`practices.${i}.description`} label="Описание" nullable />
            </FieldGroup>
          ))}
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => practices.append({ title: '', topic: TOPIC_OPTIONS[0]![0], description: null, price: null })}><PlusIcon />Добавить услугу</Button>
            <SaveBar form={practicesForm} />
          </div>
        </form>
      </Section>

      {h.practice_signups.length > 0 && (
        <Section title={<>Заявки на услуги <Badge variant="secondary">{h.practice_signups.length}</Badge></>}>
          <ItemGroup className="gap-1">
            {h.practice_signups.map((s) => (
              <Item key={s.id + s.title} size="xs" variant="muted">
                <ItemContent>
                  <ItemTitle><EntityLink entity="user" id={s.id}>{s.first_name}</EntityLink> — {s.title}</ItemTitle>
                  {s.username && <ItemDescription><TelegramLink username={s.username} /></ItemDescription>}
                </ItemContent>
                <ItemActions><ItemDescription>{new Date(s.at).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</ItemDescription></ItemActions>
              </Item>
            ))}
          </ItemGroup>
        </Section>
      )}

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
