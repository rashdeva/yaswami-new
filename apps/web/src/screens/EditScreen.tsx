import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import type { Event, EventUpdateInput, Guide } from '@yaswami/core';
import { ABOUT_MAX, ABOUT_STEP_MAX, GUIDE_MAX, TOPIC_GUIDES } from '@yaswami/core';
import type { EventData } from '../api.ts';
import { useEvent } from '../hooks/useEvent.ts';
import { haptic } from '../tg.ts';
import { CreateScreen } from './CreateScreen.tsx';

/** Разделы экрана «Редактировать». Новый раздел (билеты, абонементы…) — новая строка здесь и своя форма ниже. */
export type EditSection = 'main' | 'about';
const SECTIONS: { id: EditSection; emoji: string; title: string; hint: string }[] = [
  { id: 'main', emoji: '✏️', title: 'Основное', hint: 'название, место, время, лимит мест' },
  { id: 'about', emoji: '📝', title: 'О событии', hint: 'что будет, для кого, с чем уйдёшь, гид' },
];

interface Props {
  id: string;
  section?: EditSection;
  onSection: (section: EditSection) => void;
  onBack: (() => void) | null;
  onKind: (kind: Event['kind']) => void;
  /** Сохранили: экран возвращается к списку разделов. */
  onSaved: () => void;
  toast: (text: string) => void;
}

export function EditScreen({ id, section, onSection, onBack, onKind, onSaved, toast }: Props) {
  const { view, failed, update } = useEvent(id);
  const kind = view?.event.kind;
  useEffect(() => { if (kind) onKind(kind); }, [kind, onKind]);

  if (!view) {
    return failed ? (
      <div className="state"><b>🫥</b><p>{failed.message}</p>{onBack && <button className="chip" onClick={onBack}>← Назад</button>}</div>
    ) : (
      <div className="state"><div className="spinner" role="status" aria-label="Загрузка" /></div>
    );
  }
  if (!view.is_host) return <div className="state"><b>🔒</b><p>Редактировать может только организатор.</p></div>;

  const save: Save = async (input) => {
    try {
      await update(input);
      haptic.success();
      toast('Сохранено');
      onSaved();
    } catch (e) {
      haptic.error();
      toast((e as Error).message);
    }
  };

  return (
    <>
      <div className="top">
        {onBack && <button type="button" className="chip" onClick={onBack}>← Назад</button>}
        <h1>{section ? SECTIONS.find((s) => s.id === section)!.title : 'Редактировать'}</h1>
        <p>{view.event.name}</p>
      </div>
      {section === 'main' ? <CreateScreen onBack={null} onKind={onKind} toast={toast} editing={{ event: view.event, onSave: save }} />
        : section === 'about' ? <AboutForm event={view.event} save={save} />
        : (
          <div className="group">
            {SECTIONS.map((s) => (
              <button key={s.id} className="item" onClick={() => onSection(s.id)}>
                <i>{s.emoji}</i>
                <div><b>{s.title}</b><small>{s.hint}</small></div>
              </button>
            ))}
          </div>
        )}
    </>
  );
}

type Save = (input: EventUpdateInput) => Promise<void>;
function SaveBar({ disabled, busy }: { disabled: boolean; busy: boolean }) {
  return <div className="main"><div><button className="cta" disabled={disabled || busy}>{busy ? 'Сохраняем…' : 'Сохранить'}</button></div></div>;
}

const GUIDE_FIELDS: [keyof Guide, string][] = [
  ['what', 'Что это'], ['why', 'За чем приходят'], ['first', 'Если идёшь впервые'], ['not_for', 'Кому стоит быть осторожнее'],
];
const EMPTY_GUIDE: Guide = { what: '', why: '', first: '', not_for: '' };
const templateOf = (topic: string): Guide => {
  const g = TOPIC_GUIDES[topic];
  return g ? { what: g.what, why: g.why, first: g.first, not_for: g.not_for } : EMPTY_GUIDE;
};
const sameGuide = (a: Guide, b: Guide) => GUIDE_FIELDS.every(([k]) => a[k].trim() === b[k].trim());

/** Поля формы: шаги одной строкой на шаг, гид — всегда четыре строки (пустой гид при сохранении превращается в null). */
interface AboutValues { topic: string; steps: string; for_whom: string; beginner_friendly: boolean | null; takeaway: string; guide: Guide }

function AboutForm({ event, save }: { event: EventData['event']; save: Save }) {
  const { register, handleSubmit, watch, setValue, formState: { isSubmitting } } = useForm<AboutValues>({
    defaultValues: {
      topic: event.topic ?? '', steps: event.what_happens.join('\n'), for_whom: event.for_whom ?? '',
      beginner_friendly: event.beginner_friendly, takeaway: event.takeaway ?? '', guide: event.guide ?? EMPTY_GUIDE,
    },
  });
  const { topic, steps, beginner_friendly: beginner, guide } = watch();

  // Сменили тему: гид подставляем из шаблона, только если свои правки в нём не сделаны.
  const pickTopic = (next: string) => {
    if (sameGuide(guide, EMPTY_GUIDE) || sameGuide(guide, templateOf(topic))) setValue('guide', templateOf(next));
    setValue('topic', next); // тема — управляемое поле: у события может быть тема, которой нет в списке
  };

  const lines = steps.split('\n').map((s) => s.trim()).filter(Boolean);
  const invalid = lines.length > 10 || lines.some((s) => s.length > ABOUT_STEP_MAX);

  const submit = handleSubmit((v) => save({
    topic: v.topic || null,
    what_happens: lines,
    for_whom: v.for_whom.trim() || null,
    beginner_friendly: v.beginner_friendly,
    takeaway: v.takeaway.trim() || null,
    guide: sameGuide(v.guide, EMPTY_GUIDE) ? null : v.guide,
  }));

  const area = (label: string, name: 'steps' | 'for_whom' | 'takeaway' | `guide.${keyof Guide}`, max: number, rows = 3, placeholder?: string) => (
    <div className="group"><div className="row tall"><textarea aria-label={label} {...register(name)} rows={rows} maxLength={max} placeholder={placeholder} /></div></div>
  );

  return (
    <form onSubmit={submit} noValidate>
      <h2>Что будет</h2>
      {area('Что будет', 'steps', ABOUT_STEP_MAX * 10, 4, 'По шагу в строке: разминка, танец в парах, чай')}
      {invalid && <p className="error" role="alert">Не больше 10 шагов, каждый до {ABOUT_STEP_MAX} символов</p>}

      <h2>Для кого</h2>
      {area('Для кого', 'for_whom', ABOUT_MAX, 2, 'Кому подойдёт')}
      <div className="chips">
        {([[null, 'Не указывать'], [true, 'Можно без опыта'], [false, 'Нужен опыт']] as const).map(([value, label]) => (
          <button key={label} type="button" className="chip" aria-pressed={beginner === value} onClick={() => setValue('beginner_friendly', value)}>{label}</button>
        ))}
      </div>

      <h2>С чем уйдёшь</h2>
      {area('С чем уйдёшь', 'takeaway', ABOUT_MAX, 2, 'Что получит человек — ваше обещание')}

      <h2>Гид по формату</h2>
      <div className="group"><div className="row">
        <label htmlFor="e-topic">Тема</label>
        <select id="e-topic" value={topic} onChange={(e) => pickTopic(e.target.value)}>
          <option value="">Без темы</option>
          {Object.keys(TOPIC_GUIDES).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div></div>
      {(topic || !sameGuide(guide, EMPTY_GUIDE)) && GUIDE_FIELDS.map(([key, label]) => (
        <div key={key}>
          <h2 className="cap">{label}</h2>
          {area(label, `guide.${key}`, GUIDE_MAX, 4)}
        </div>
      ))}
      <p className="note">Гид можно править под ваше событие: при выборе темы он подставляется из шаблона.</p>
      <SaveBar disabled={invalid} busy={isSubmitting} />
    </form>
  );
}
