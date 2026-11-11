import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { ADDRESS_MAX, DESCRIPTION_MAX, Event, NAME_MAX, TEMPLATES } from '@yaswami/core';
import type { EventData } from '../api.ts';
import { api } from '../api.ts';
import { localDate } from '../format.ts';
import { haptic } from '../tg.ts';

const isUrl = (s: string) => /^https?:\/\//i.test(s);

// Форма — то, что вводит человек (дата и время раздельно, место одной строкой). Правила полей — из ядра,
// чтобы форма и бэк не расходились; в запрос к API она превращается в onSubmit.
const FormSchema = z
  .object({
    kind: Event.shape.kind,
    name: Event.shape.name,
    place: z.string().trim().max(500),
    description: z.string().trim().max(DESCRIPTION_MAX),
    date: z.iso.date('Выберите дату'),
    time: z.string().regex(/^\d{2}:\d{2}$/, 'Выберите время'),
    max_capacity: z.number().int().min(0), // 0 — без лимита
    allow_plus_one: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (isUrl(v.place) ? !URL.canParse(v.place) : v.place.length > ADDRESS_MAX) {
      ctx.addIssue({ code: 'custom', path: ['place'], message: isUrl(v.place) ? 'Проверьте ссылку' : `Адрес длиннее ${ADDRESS_MAX} символов` });
    }
    if (new Date(`${v.date}T${v.time}`).getTime() <= Date.now()) {
      ctx.addIssue({ code: 'custom', path: ['time'], message: 'Это время уже прошло' });
    }
  });

const daysToSaturday = (6 - new Date().getDay() + 7) % 7 || 7;
const DAYS = [['Сегодня', 0], ['Завтра', 1], ['В субботу', daysToSaturday]] as const;

interface Props {
  onBack: (() => void) | null;
  onCreated: (view: EventData) => void;
  onKind: (kind: Event['kind']) => void;
  toast: (text: string) => void;
}

export function CreateScreen({ onBack, onCreated, onKind, toast }: Props) {
  const { register, handleSubmit, watch, setValue, formState: { errors, isValid, isSubmitting } } = useForm({
    resolver: zodResolver(FormSchema),
    mode: 'onChange',
    defaultValues: {
      kind: 'f' as Event['kind'], name: '', place: '', description: '', date: localDate(1), time: '19:30',
      max_capacity: TEMPLATES.f.max_capacity ?? 0, allow_plus_one: TEMPLATES.f.allow_plus_one,
    },
  });
  const [descOpen, setDescOpen] = useState(false);
  const { kind, date, max_capacity: capacity, allow_plus_one: plusOne } = watch();
  const template = TEMPLATES[kind];
  const set = { shouldValidate: true, shouldDirty: true };

  useEffect(() => onKind(kind), [kind, onKind]);

  const pickKind = (next: Event['kind']) => {
    haptic.select();
    setValue('kind', next, set);
    // настройки шаблона: свадьбе — лимит 60 и «+1», спорту — 10 мест
    setValue('max_capacity', TEMPLATES[next].max_capacity ?? 0, set);
    setValue('allow_plus_one', TEMPLATES[next].allow_plus_one, set);
  };
  const stepCapacity = (direction: 1 | -1) => {
    haptic.select();
    setValue('max_capacity', Math.max(0, capacity + direction * (capacity >= 20 ? 5 : 1)), set);
  };

  const submit = handleSubmit(async (v) => {
    try {
      const view = await api.createEvent({
        kind: v.kind,
        name: v.name,
        description: v.description || null,
        start_at: new Date(`${v.date}T${v.time}`).toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        geo_address_json: v.place && !isUrl(v.place) ? { address: v.place } : null,
        meeting_url: isUrl(v.place) ? v.place : null,
        max_capacity: v.max_capacity || null,
        allow_plus_one: v.allow_plus_one,
      });
      haptic.success();
      onCreated(view);
    } catch (e) {
      haptic.error();
      toast((e as Error).message);
    }
  });

  const error = errors.place?.message ?? errors.date?.message ?? errors.time?.message;

  return (
    <form onSubmit={submit} noValidate>
      <div className="top">
        {onBack && <button type="button" className="chip" onClick={onBack}>← Мои события</button>}
        <h1>Что планируем?</h1>
        <p>Выберите формат — остальное займёт полминуты.</p>
      </div>

      <div className="kinds" role="group" aria-label="Формат события">
        {(Object.keys(TEMPLATES) as Event['kind'][]).map((id) => (
          <button key={id} type="button" className="kind" aria-pressed={id === kind} onClick={() => pickKind(id)}>
            <b>{TEMPLATES[id].emoji}</b>{TEMPLATES[id].name}
          </button>
        ))}
      </div>

      <h2>Событие</h2>
      <div className="group">
        <div className="row">
          <label htmlFor="name">Название</label>
          <input id="name" {...register('name')} placeholder={template.placeholder} maxLength={NAME_MAX} autoComplete="off" enterKeyHint="next" />
        </div>
        <div className="row" aria-invalid={!!errors.place}>
          <label htmlFor="place">Где</label>
          <input id="place" {...register('place')} placeholder="Адрес или ссылка" autoComplete="off" enterKeyHint="done" />
        </div>
      </div>
      {descOpen ? (
        <div className="group">
          <div className="row tall">
            <label htmlFor="description">Описание</label>
            <textarea id="description" {...register('description')} rows={2} maxLength={DESCRIPTION_MAX} placeholder="Что взять, как добраться, дресс-код" autoFocus />
          </div>
        </div>
      ) : (
        <button type="button" className="quiet" onClick={() => { haptic.tap(); setDescOpen(true); }}>＋ Добавить описание</button>
      )}

      <h2>Когда</h2>
      <div className="chips">
        {DAYS.map(([label, offset]) => (
          <button key={label} type="button" className="chip" aria-pressed={date === localDate(offset)}
            onClick={() => { haptic.select(); setValue('date', localDate(offset), set); }}>
            {label}
          </button>
        ))}
      </div>
      <div className="group">
        <div className="row" aria-invalid={!!errors.date}>
          <label htmlFor="date">Дата</label>
          <input id="date" type="date" {...register('date')} min={localDate()} />
        </div>
        <div className="row" aria-invalid={!!errors.time}>
          <label htmlFor="time">Время</label>
          <input id="time" type="time" {...register('time')} />
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      <h2>Гости</h2>
      <div className="group">
        <div className="row">
          Лимит мест
          <div className="step">
            <button type="button" aria-label="Меньше мест" onClick={() => stepCapacity(-1)}>−</button>
            <span aria-live="polite">{capacity || 'нет'}</span>
            <button type="button" aria-label="Больше мест" onClick={() => stepCapacity(1)}>+</button>
          </div>
        </div>
        <div className="row">
          Можно прийти с +1
          <button type="button" className="sw" role="switch" aria-checked={plusOne} aria-label="Можно прийти с +1"
            onClick={() => { haptic.select(); setValue('allow_plus_one', !plusOne, set); }} />
        </div>
      </div>
      <p className="note">Гостям не нужно ничего устанавливать: они открывают ссылку и отвечают в одно касание.</p>

      <div className="main"><div>
        <button className="cta" disabled={!isValid || isSubmitting}>{isSubmitting ? 'Создаём…' : 'Создать и поделиться'}</button>
      </div></div>
    </form>
  );
}
