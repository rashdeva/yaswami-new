// Новое событие Ясвами от имени организатора: его лимит бесплатных событий действует.
import { zodResolver } from '@hookform/resolvers/zod';
import type { AdminEventCreateInput, User } from '@yaswami/core';
import { AdminEventCreateInput as Schema } from '@yaswami/core';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { EventFields } from '@/components/EventFields';
import { showIssues } from '@/components/Fields';
import { Page, Section } from '@/components/Page';
import { UserPicker } from '@/components/UserPicker';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { useCreateEvent } from '@/hooks/useEvents';

/** Завтра в 19:00 по часам браузера. */
const tomorrowEvening = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(19, 0, 0, 0);
  return d.toISOString();
};

const defaults = (): Omit<AdminEventCreateInput, 'user_id'> => ({
  kind: 'o', name: '', start_at: tomorrowEvening(), end_at: null, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, status: 'draft',
  what_happens: [], allow_plus_one: false,
});

export function EventNewScreen({ onCreated }: { onCreated: (id: string) => void }) {
  const create = useCreateEvent();
  const [host, setHost] = useState<User | null>(null);
  const form = useForm({
    resolver: zodResolver(Schema),
    defaultValues: defaults() as AdminEventCreateInput, // организатора выбирают отдельно
  });
  const submit = form.handleSubmit((input) => create(input as AdminEventCreateInput, { onSuccess: (v) => onCreated(v.event.id), onError: (e) => showIssues(form, e) }));
  const hostError = form.formState.errors.user_id;

  return (
    <Page title="Новое событие Ясвами">
      <Section title="Событие">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field data-invalid={!!hostError}>
            <FieldLabel>Организатор</FieldLabel>
            <UserPicker label="Выбрать пользователя…" picked={host} onPick={(u) => (setHost(u), form.setValue('user_id', u.id, { shouldValidate: true }))} />
            <FieldError errors={[hostError && { message: 'Выберите организатора' }]} />
          </Field>
          <EventFields form={form} />
          <div><Button type="submit">Создать</Button></div>
        </form>
      </Section>
    </Page>
  );
}
