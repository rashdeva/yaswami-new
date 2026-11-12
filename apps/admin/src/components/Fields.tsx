// Поля форм на react-hook-form и shadcn Field. Форма держит значения в форме API (null, ISO, массивы),
// поле переводит их в то, что показать, и обратно — поэтому схема из core проверяет форму как есть.
import { useState } from 'react';
import { Controller } from 'react-hook-form';
import { toast } from 'sonner';
import type { ApiError } from '@/api';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { fromLocal, issueFields, pickDirty, splitList, toLocal } from '@/lib/form';

/**
 * Форма для полей: то, что им нужно от useForm, без типа значений — поля общие для любых форм.
 * Методы (а не свойства-функции), чтобы useForm с любым типом значений подходил сюда как есть.
 */
export interface Form {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: any;
  formState: { isDirty: boolean; dirtyFields: object };
  setError(name: string, error: { message: string }): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleSubmit(onValid: (values: any) => void): (e?: React.BaseSyntheticEvent) => Promise<void>;
  reset(values?: object): void;
  watch(name: string): unknown;
}
export interface Base {
  form: Form;
  name: string;
  label: string;
  hint?: string;
}

/** Поле со своим вводом: подпись, подсказка и ошибка — как у остальных. */
export function Shell({ form, name, label, hint, children, inline }: Base & { children: (field: { value: unknown; onChange: (v: unknown) => void; onBlur: () => void }) => React.ReactNode; inline?: boolean }) {
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid} orientation={inline ? 'horizontal' : 'vertical'}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          {children(field)}
          {hint && <FieldDescription>{hint}</FieldDescription>}
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}

/** Строка. `nullable` — пустое поле значит null. */
export function TextField({ nullable, type = 'text', placeholder, ...p }: Base & { nullable?: boolean; type?: string; placeholder?: string }) {
  return (
    <Shell {...p}>
      {(f) => <Input id={p.name} type={type} placeholder={placeholder} value={(f.value as string | null) ?? ''} onBlur={f.onBlur} onChange={(e) => f.onChange(nullable && !e.target.value ? null : e.target.value)} />}
    </Shell>
  );
}

export function AreaField({ nullable, rows = 3, ...p }: Base & { nullable?: boolean; rows?: number }) {
  return (
    <Shell {...p}>
      {(f) => <Textarea id={p.name} rows={rows} value={(f.value as string | null) ?? ''} onBlur={f.onBlur} onChange={(e) => f.onChange(nullable && !e.target.value ? null : e.target.value)} />}
    </Shell>
  );
}

/** Целое число; пустое — null. */
export function NumberField(p: Base) {
  return (
    <Shell {...p}>
      {(f) => <Input id={p.name} type="number" inputMode="numeric" value={(f.value as number | null) ?? ''} onBlur={f.onBlur} onChange={(e) => f.onChange(e.target.value === '' ? null : Number(e.target.value))} />}
    </Shell>
  );
}

/** Дата и время на стене: `zone` — IANA-пояс или смещение (`+07:00`); значение формы — ISO. */
export function DateTimeField({ zone, nullable, ...p }: Base & { zone: string; nullable?: boolean }) {
  return (
    <Shell {...p}>
      {(f) => (
        <Input
          id={p.name} type="datetime-local" value={f.value ? toLocal(f.value as string, zone) : ''} onBlur={f.onBlur}
          onChange={(e) => f.onChange(e.target.value ? fromLocal(e.target.value, zone) : nullable ? null : '')}
        />
      )}
    </Shell>
  );
}

export function SwitchField(p: Base) {
  return <Shell {...p} inline>{(f) => <Switch id={p.name} checked={!!f.value} onCheckedChange={f.onChange} />}</Shell>;
}

const NONE = '__none'; // у Radix Select не бывает пустого значения

/** Выбор из списка; `nullable` — пункт «не указано» значит null. */
export function SelectField({ options, nullable, ...p }: Base & { options: readonly (readonly [string, string])[]; nullable?: boolean }) {
  return (
    <Shell {...p}>
      {(f) => (
        <Select value={(f.value as string | null) ?? NONE} onValueChange={(v) => f.onChange(v === NONE ? null : v)}>
          <SelectTrigger id={p.name} className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {nullable && <SelectItem value={NONE}>не указано</SelectItem>}
            {options.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
    </Shell>
  );
}

/** Да / нет / не сказано (`boolean | null`). */
export function TriField(p: Base) {
  return (
    <Shell {...p}>
      {(f) => (
        <Select value={f.value === true ? 'yes' : f.value === false ? 'no' : NONE} onValueChange={(v) => f.onChange(v === 'yes' ? true : v === 'no' ? false : null)}>
          <SelectTrigger id={p.name} className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>не сказано</SelectItem>
            <SelectItem value="yes">да</SelectItem>
            <SelectItem value="no">нет</SelectItem>
          </SelectContent>
        </Select>
      )}
    </Shell>
  );
}

/** Список строк: по строке или через запятую. Пока человек печатает, текст живёт в поле, в форму идёт список. */
function ListInput({ value, onChange, by, id }: { value: string[] | undefined; onChange: (v: string[]) => void; by: 'line' | 'comma'; id: string }) {
  const sep = by === 'line' ? '\n' : ', ';
  const [text, setText] = useState(() => (value ?? []).join(sep));
  const [seen, setSeen] = useState(value);
  // Значение сменилось снаружи (перечитали с сервера, сбросили форму) — показать его.
  if (value !== seen) {
    setSeen(value);
    if (splitList(text, by).join('\u0000') !== (value ?? []).join('\u0000')) setText((value ?? []).join(sep));
  }
  const change = (t: string) => (setText(t), onChange(splitList(t, by)));
  return by === 'line'
    ? <Textarea id={id} rows={4} value={text} onChange={(e) => change(e.target.value)} />
    : <Input id={id} value={text} onChange={(e) => change(e.target.value)} />;
}

export function ListField({ by, ...p }: Base & { by: 'line' | 'comma' }) {
  return <Shell {...p}>{(f) => <ListInput id={p.name} by={by} value={f.value as string[] | undefined} onChange={f.onChange} />}</Shell>;
}

/** Ошибки полей от сервера (`invalid_input`) — у полей; остальное уже показал тост. */
export function showIssues(form: Form, e: Error) {
  for (const [name, message] of issueFields((e as ApiError).issues)) form.setError(name, { message });
}

/**
 * Сохранить форму: шлём только изменённые поля; ничего не меняли — ничего не шлём. После успеха изменённое
 * становится исходным, ошибки сервера встают у полей.
 */
export function saveDirty<Input>(form: Form, save: (input: Input, callbacks: { onSuccess: () => void; onError: (e: Error) => void }) => void) {
  return form.handleSubmit((values) => {
    const input = pickDirty(values, form.formState.dirtyFields as Record<string, unknown>);
    if (!Object.keys(input).length) return void toast('Ничего не изменилось');
    save(input as Input, { onSuccess: () => form.reset(values), onError: (e) => showIssues(form, e) });
  });
}

export function SaveBar({ form, label = 'Сохранить' }: { form: Form; label?: string }) {
  const dirty = form.formState.isDirty;
  return (
    <div className="flex items-center gap-2">
      <Button type="submit" disabled={!dirty}>{label}</Button>
      {dirty && <Button type="button" variant="ghost" onClick={() => form.reset()}>Сбросить</Button>}
    </div>
  );
}
