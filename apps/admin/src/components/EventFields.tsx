// Поля события Ясвами — одни для создания и правки. Значения формы — как в EventUpdateInput.
import type { AdminEventUpdateInput, Event, Guide, Wire } from '@yaswami/core';
import { EVENT_STATUSES, TEMPLATES } from '@yaswami/core';
import { CityField } from '@/components/City';
import type { Base, Form } from '@/components/Fields';
import { AreaField, DateTimeField, ListField, NumberField, SelectField, Shell, SwitchField, TextField, TriField } from '@/components/Fields';
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { EVENT_STATUS_LABELS } from '@/lib/catalog';

const KINDS = Object.entries(TEMPLATES).map(([k, t]) => [k, `${t.emoji} ${t.name}`] as const);
const STATUSES = EVENT_STATUSES.map((s) => [s, EVENT_STATUS_LABELS[s]] as const);
const GUIDE: [keyof Guide, string][] = [['what', 'Что это'], ['why', 'Зачем идти'], ['first', 'Если впервые'], ['not_for', 'Кому не подойдёт']];

/** Адрес — объект `{ address }` или null. */
function AddressField(p: Base) {
  return (
    <Shell {...p}>
      {(f) => (
        <Input id={p.name} value={(f.value as { address: string } | null)?.address ?? ''} onBlur={f.onBlur} onChange={(e) => f.onChange(e.target.value ? { address: e.target.value } : null)} />
      )}
    </Shell>
  );
}

/** Гид по формату: четыре текста или null, если все пустые. */
function GuideField(p: Base) {
  return (
    <Shell {...p}>
      {(f) => {
        const guide = (f.value as Guide | null) ?? { what: '', why: '', first: '', not_for: '' };
        const set = (key: keyof Guide, text: string) => {
          const next = { ...guide, [key]: text };
          f.onChange(Object.values(next).some(Boolean) ? next : null);
        };
        return (
          <div className="grid gap-2 md:grid-cols-2">
            {GUIDE.map(([key, label]) => (
              <Field key={key}>
                <FieldLabel htmlFor={`guide-${key}`}>{label}</FieldLabel>
                <Textarea id={`guide-${key}`} rows={3} value={guide[key]} onBlur={f.onBlur} onChange={(e) => set(key, e.target.value)} />
              </Field>
            ))}
          </div>
        );
      }}
    </Shell>
  );
}

export function EventFields({ form }: { form: Form }) {
  const timezone = (form.watch('timezone') as string | undefined) || Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <FieldGroup>
      <div className="grid gap-4 md:grid-cols-2">
        <TextField form={form} name="name" label="Название" />
        <SelectField form={form} name="kind" label="Вид" options={KINDS} />
        <SelectField form={form} name="status" label="Статус" options={STATUSES} />
        <CityField form={form} />
        <TextField form={form} name="timezone" label="Часовой пояс" hint="IANA, например Asia/Tbilisi" />
        <DateTimeField form={form} name="start_at" label="Начало" zone={timezone} hint={`Время в поясе ${timezone}`} />
        <DateTimeField form={form} name="end_at" label="Конец" zone={timezone} nullable />
        <AddressField form={form} name="geo_address_json" label="Адрес" />
        <TextField form={form} name="meeting_url" label="Ссылка на встречу" nullable type="url" />
        <NumberField form={form} name="max_capacity" label="Мест всего" hint="Пусто — без ограничения" />
        <SwitchField form={form} name="allow_plus_one" label="Можно «+1»" />
      </div>
      <AreaField form={form} name="description" label="Описание" nullable />
      <FieldSet>
        <FieldLegend variant="label">Что это мне даст</FieldLegend>
        <div className="grid gap-4 md:grid-cols-2">
          <TextField form={form} name="topic" label="Тема" nullable />
          <TriField form={form} name="beginner_friendly" label="Подходит новичкам" />
          <TextField form={form} name="for_whom" label="Для кого" nullable />
          <TextField form={form} name="takeaway" label="Что унесёт гость" nullable />
        </div>
        <ListField form={form} name="what_happens" label="Что будет, по шагам" by="line" hint="Шаг — на отдельной строке" />
      </FieldSet>
      <GuideField form={form} name="guide" label="Гид по формату" />
    </FieldGroup>
  );
}

/** Значения формы из события: ровно поля AdminEventUpdateInput. */
export const eventValues = (e: Wire<Event>): AdminEventUpdateInput => ({
  kind: e.kind, name: e.name, description: e.description, start_at: e.start_at, end_at: e.end_at, timezone: e.timezone, geo_address_json: e.geo_address_json,
  meeting_url: e.meeting_url, max_capacity: e.max_capacity, allow_plus_one: e.allow_plus_one, topic: e.topic, what_happens: e.what_happens, for_whom: e.for_whom,
  beginner_friendly: e.beginner_friendly, takeaway: e.takeaway, guide: e.guide, status: e.status, city_id: e.city_id,
});
