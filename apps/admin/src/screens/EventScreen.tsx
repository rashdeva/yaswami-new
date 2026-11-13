// Карточка события Ясвами: поля, типы билетов, гости, отзывы, история. Всё — от имени организатора, правила мест те же.
import { zodResolver } from '@hookform/resolvers/zod';
import type { AdminGuest, RsvpStatus, TicketType, User, Wire } from '@yaswami/core';
import { AdminEventUpdateInput, TicketTypeCreateInput, TicketTypeUpdateInput } from '@yaswami/core';
import { ExternalLinkIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Confirm, UNDO_HINT } from '@/components/Confirm';
import { EntityLink, TelegramLink } from '@/components/EntityLink';
import { eventValues, EventFields } from '@/components/EventFields';
import { AreaField, NumberField, SaveBar, saveDirty, showIssues, SwitchField, TextField } from '@/components/Fields';
import { History } from '@/components/History';
import { Failed, Hint, Loading, Page, Section } from '@/components/Page';
import { UserPicker } from '@/components/UserPicker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useEvent, useEventActions, useFeedback, useGuests } from '@/hooks/useEvents';
import { APPROVAL_LABELS, EVENT_STATUS_LABELS } from '@/lib/catalog';

type Actions = ReturnType<typeof useEventActions>;
const ANSWERS: RsvpStatus[] = ['approved', 'maybe', 'declined'];
const NO_TICKET = '__none';

export function EventScreen({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const { data: view, error } = useEvent(id);
  const act = useEventActions(id);
  const values = useMemo(() => view && eventValues(view.event), [view]);
  const form = useForm({ resolver: zodResolver(AdminEventUpdateInput), values, resetOptions: { keepDirtyValues: true } });

  if (error) return <Page title="Событие"><Failed error={error} /></Page>;
  if (!view) return <Page title="Событие"><Loading rows={8} /></Page>;
  const e = view.event;

  return (
    <Page
      title={<>{e.name} <Badge variant={e.status === 'published' ? 'default' : 'secondary'}>{EVENT_STATUS_LABELS[e.status]}</Badge></>}
      description={<>
        Организатор: <EntityLink entity="user" id={e.user_id}>{view.host.first_name}</EntityLink> · идут {view.guest_counts.approved}, думают {view.guest_counts.maybe}, отказались {view.guest_counts.declined}
        {view.feedback.average !== null && ` · оценка ${view.feedback.average.toFixed(1)} из 5`}
      </>}
      actions={
        <>
          <Button size="sm" variant="outline" asChild><a href={view.url} target="_blank" rel="noreferrer"><ExternalLinkIcon />В приложении</a></Button>
          <Confirm
            title={`Удалить «${e.name}»?`}
            description={`Событие исчезнет вместе с гостями, типами билетов и отзывами. ${UNDO_HINT}`}
            onConfirm={() => act.remove(undefined, { onSuccess: onDeleted })}
          >
            <Button size="sm" variant="outline"><Trash2Icon />Удалить</Button>
          </Confirm>
        </>
      }
    >
      <Section title="Поля события">
        <form onSubmit={saveDirty(form, act.update)} className="flex flex-col gap-4">
          <EventFields form={form} />
          <SaveBar form={form} />
        </form>
      </Section>

      <TicketTypes types={view.ticket_types} act={act} />
      <Guests id={id} types={view.ticket_types} allowPlusOne={e.allow_plus_one} act={act} />
      <Feedback id={id} act={act} />
      <History entity="event" id={id} />
    </Page>
  );
}

/** Форма типа билета: новый или правка. */
function TicketTypeDialog({ type, act, children }: { type?: TicketType; act: Actions; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const form = useForm({
    resolver: zodResolver(type ? TicketTypeUpdateInput : TicketTypeCreateInput),
    values: type ?? { name: '', description: null, price_text: null, max_capacity: null, is_hidden: false },
  });
  const close = { onSuccess: () => (setOpen(false), form.reset()), onError: (e: Error) => showIssues(form, e) };
  const submit = form.handleSubmit((input) =>
    type ? act.updateTicketType({ ticket: type.id, input }, close) : act.createTicketType(input as TicketTypeCreateInput, close));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{type ? `Тип билета «${type.name}»` : 'Новый тип билета'}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <FieldGroup>
            <TextField form={form} name="name" label="Название" />
            <TextField form={form} name="price_text" label="Цена, подписью" nullable hint="Денег система не трогает" />
            <NumberField form={form} name="max_capacity" label="Мест этого типа" hint="Пусто — без ограничения" />
            {type && <NumberField form={form} name="position" label="Порядок" />}
            <SwitchField form={form} name="is_hidden" label="Скрытый — виден только тем, кому назначен" />
            <AreaField form={form} name="description" label="Описание" nullable />
          </FieldGroup>
          <DialogFooter><Button type="submit">{type ? 'Сохранить' : 'Добавить'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TicketTypes({ types, act }: { types: TicketType[]; act: Actions }) {
  return (
    <Section title="Типы билетов" actions={<TicketTypeDialog act={act}><Button size="sm" variant="outline"><PlusIcon />Добавить</Button></TicketTypeDialog>}>
      <Table>
        <TableHeader><TableRow><TableHead>Название</TableHead><TableHead>Цена</TableHead><TableHead>Мест</TableHead><TableHead /><TableHead /></TableRow></TableHeader>
        <TableBody>
          {types.map((t) => (
            <TableRow key={t.id}>
              <TableCell>{t.name} {t.is_hidden && <Badge variant="secondary">скрытый</Badge>}</TableCell>
              <TableCell>{t.price_text ?? '—'}</TableCell>
              <TableCell>{t.max_capacity ?? '∞'}</TableCell>
              <TableCell className="max-w-xs truncate text-muted-foreground">{t.description}</TableCell>
              <TableCell className="text-right">
                <TicketTypeDialog type={t} act={act}><Button size="icon-sm" variant="ghost" aria-label="Изменить"><PencilIcon /></Button></TicketTypeDialog>
                <Confirm title={`Удалить тип «${t.name}»?`} description={`Гостей с этим типом быть не должно. ${UNDO_HINT}`} onConfirm={() => act.removeTicketType(t.id)}>
                  <Button size="icon-sm" variant="ghost" aria-label="Удалить"><Trash2Icon /></Button>
                </Confirm>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  );
}

function TicketSelect({ types, value, onChange, disabled }: { types: TicketType[]; value: string | null; onChange: (id: string | undefined) => void; disabled?: boolean }) {
  return (
    <Select value={value ?? NO_TICKET} disabled={disabled} onValueChange={(v) => onChange(v === NO_TICKET ? undefined : v)}>
      <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_TICKET}>без билета</SelectItem>
        {types.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}{t.is_hidden ? ' (скрытый)' : ''}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function AnswerSelect({ value, onChange }: { value: Wire<AdminGuest>['approval_status']; onChange: (v: RsvpStatus) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as RsvpStatus)}>
      <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
      <SelectContent>
        {value === 'waitlist' && <SelectItem value="waitlist" disabled>{APPROVAL_LABELS.waitlist}</SelectItem>}
        {ANSWERS.map((s) => <SelectItem key={s} value={s}>{APPROVAL_LABELS[s]}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function Guests({ id, types, allowPlusOne, act }: { id: string; types: TicketType[]; allowPlusOne: boolean; act: Actions }) {
  const { data } = useGuests(id);
  const [user, setUser] = useState<User | null>(null);
  const [answer, setAnswer] = useState<RsvpStatus>('approved');
  const [ticket, setTicket] = useState<string | undefined>();
  return (
    <Section title={<>Гости <Badge variant="secondary">{data?.length ?? '…'}</Badge></>}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <UserPicker label="Записать пользователя…" picked={user} onPick={setUser} />
        <AnswerSelect value={answer} onChange={setAnswer} />
        <TicketSelect types={types} value={ticket ?? null} onChange={setTicket} />
        <Button
          size="sm" disabled={!user}
          onClick={() => user && act.setGuest({ user_id: user.id, approval_status: answer, event_ticket_type_id: ticket }, { onSuccess: () => setUser(null) })}
        >
          Записать
        </Button>
      </div>
      {!data && <Loading rows={3} />}
      {data?.length === 0 && <Hint>Никто ещё не ответил.</Hint>}
      {!!data?.length && (
        <Table>
          <TableHeader><TableRow><TableHead>Гость</TableHead><TableHead>Ответ</TableHead><TableHead>Билет</TableHead><TableHead>+1</TableHead><TableHead>Когда</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {data.map((g) => {
              // Ответ «лист ожидания» ставит система; билет и «+1» меняются вместе с ответом, поэтому у него сначала выберите ответ.
              const set = (change: { approval_status?: RsvpStatus; event_ticket_type_id?: string; plus_ones?: number }) =>
                act.setGuest({ user_id: g.user_id, approval_status: (g.approval_status === 'waitlist' ? 'approved' : g.approval_status) as RsvpStatus, ...change });
              const waitlist = g.approval_status === 'waitlist';
              return (
                <TableRow key={g.user_id}>
                  <TableCell><EntityLink entity="user" id={g.user_id}>{g.user_first_name}</EntityLink> {g.user_username && <TelegramLink username={g.user_username} />}</TableCell>
                  <TableCell><AnswerSelect value={g.approval_status} onChange={(s) => set({ approval_status: s })} /></TableCell>
                  <TableCell><TicketSelect types={types} value={g.event_ticket_type_id} disabled={waitlist} onChange={(t) => t && set({ event_ticket_type_id: t })} /></TableCell>
                  <TableCell>
                    <Input
                      key={g.plus_ones} type="number" min={0} max={10} defaultValue={g.plus_ones} disabled={!allowPlusOne || waitlist} className="w-16"
                      onBlur={(e) => Number(e.target.value) !== g.plus_ones && set({ plus_ones: Number(e.target.value) })}
                      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{new Date(g.registered_at).toLocaleDateString('ru')}</TableCell>
                  <TableCell className="text-right">
                    <Confirm title={`Убрать ${g.user_first_name} из гостей?`} description={`Ответ и билет гостя пропадут, место освободится. ${UNDO_HINT}`} action="Убрать" onConfirm={() => act.removeGuest(g.user_id)}>
                      <Button size="icon-sm" variant="ghost" aria-label="Убрать"><Trash2Icon /></Button>
                    </Confirm>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}

function Feedback({ id, act }: { id: string; act: Actions }) {
  const { data } = useFeedback(id);
  if (!data?.length) return null; // отзывы бывают только у прошедших событий
  return (
    <Section title="Отзывы">
      <ItemGroup className="gap-1">
        {data.map((f) => (
          <Item key={f.user_id} size="xs" variant="muted" className="items-start">
            <ItemMedia><Badge variant={f.rating ? 'default' : 'outline'}>{f.rating ? '★'.repeat(f.rating) : 'нет ответа'}</Badge></ItemMedia>
            <ItemContent>
              <ItemTitle><EntityLink entity="user" id={f.user_id}>{f.user_first_name}</EntityLink></ItemTitle>
              {f.comment && <ItemDescription className="line-clamp-none whitespace-pre-wrap">{f.comment}</ItemDescription>}
            </ItemContent>
            <ItemActions>
              <Confirm title="Удалить отзыв?" description={`Оценка и комментарий ${f.user_first_name} пропадут. ${UNDO_HINT}`} onConfirm={() => act.removeFeedback(f.user_id)}>
                <Button size="icon-sm" variant="ghost" aria-label="Удалить"><Trash2Icon /></Button>
              </Confirm>
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
    </Section>
  );
}
