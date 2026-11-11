import { useEffect, useState } from 'react';
import type { Event, Guide } from '@yaswami/core';
import { ABOUT_MAX, ABOUT_STEP_MAX, GUIDE_MAX, TOPIC_GUIDES } from '@yaswami/core';
import type { EventData } from '../api.ts';
import { api } from '../api.ts';
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
  initial?: EventData;
  section?: EditSection;
  onSection: (section: EditSection) => void;
  onBack: (() => void) | null;
  onKind: (kind: Event['kind']) => void;
  /** Сохранили: новое состояние события; экран возвращается к списку разделов. */
  onSaved: (view: EventData) => void;
  toast: (text: string) => void;
}

export function EditScreen({ id, initial, section, onSection, onBack, onKind, onSaved, toast }: Props) {
  const [view, setView] = useState<EventData | null>(initial ?? null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => { api.event(id).then(setView, (e: Error) => setFailed(e.message)); }, [id]);
  useEffect(() => { if (initial) setView(initial); }, [initial]); // после сохранения приходит свежее состояние
  const kind = view?.event.kind;
  useEffect(() => { if (kind) onKind(kind); }, [kind, onKind]);

  if (!view) {
    return failed ? (
      <div className="state"><b>🫥</b><p>{failed}</p>{onBack && <button className="chip" onClick={onBack}>← Назад</button>}</div>
    ) : (
      <div className="state"><div className="spinner" role="status" aria-label="Загрузка" /></div>
    );
  }
  if (!view.is_host) return <div className="state"><b>🔒</b><p>Редактировать может только организатор.</p></div>;

  const save = async (input: Parameters<typeof api.updateEvent>[1]) => {
    try {
      const next = await api.updateEvent(id, input);
      haptic.success();
      toast('Сохранено');
      onSaved(next);
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

type Save = (input: Parameters<typeof api.updateEvent>[1]) => Promise<void>;
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

function AboutForm({ event, save }: { event: EventData['event']; save: Save }) {
  const [topic, setTopic] = useState(event.topic ?? '');
  const [steps, setSteps] = useState(event.what_happens.join('\n'));
  const [forWhom, setForWhom] = useState(event.for_whom ?? '');
  const [beginner, setBeginner] = useState<boolean | null>(event.beginner_friendly);
  const [takeaway, setTakeaway] = useState(event.takeaway ?? '');
  const [guide, setGuide] = useState<Guide>(event.guide ?? EMPTY_GUIDE);
  const [busy, setBusy] = useState(false);

  // Сменили тему: гид подставляем из шаблона, только если свои правки в нём не сделаны.
  const pickTopic = (next: string) => {
    if (sameGuide(guide, EMPTY_GUIDE) || sameGuide(guide, templateOf(topic))) setGuide(templateOf(next));
    setTopic(next);
  };

  const lines = steps.split('\n').map((s) => s.trim()).filter(Boolean);
  const invalid = lines.length > 10 || lines.some((s) => s.length > ABOUT_STEP_MAX);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await save({
      topic: topic || null,
      what_happens: lines,
      for_whom: forWhom.trim() || null,
      beginner_friendly: beginner,
      takeaway: takeaway.trim() || null,
      guide: sameGuide(guide, EMPTY_GUIDE) ? null : guide,
    });
    setBusy(false);
  };

  const area = (label: string, value: string, set: (v: string) => void, max: number, rows = 3, placeholder?: string) => (
    <div className="group"><div className="row tall"><textarea aria-label={label} value={value} onChange={(e) => set(e.target.value)} rows={rows} maxLength={max} placeholder={placeholder} /></div></div>
  );

  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
      <h2>Что будет</h2>
      {area('Что будет', steps, setSteps, ABOUT_STEP_MAX * 10, 4, 'По шагу в строке: разминка, танец в парах, чай')}
      {invalid && <p className="error" role="alert">Не больше 10 шагов, каждый до {ABOUT_STEP_MAX} символов</p>}

      <h2>Для кого</h2>
      {area('Для кого', forWhom, setForWhom, ABOUT_MAX, 2, 'Кому подойдёт')}
      <div className="chips">
        {([[null, 'Не указывать'], [true, 'Можно без опыта'], [false, 'Нужен опыт']] as const).map(([value, label]) => (
          <button key={label} type="button" className="chip" aria-pressed={beginner === value} onClick={() => setBeginner(value)}>{label}</button>
        ))}
      </div>

      <h2>С чем уйдёшь</h2>
      {area('С чем уйдёшь', takeaway, setTakeaway, ABOUT_MAX, 2, 'Что получит человек — ваше обещание')}

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
          {area(label, guide[key], (v) => setGuide({ ...guide, [key]: v }), GUIDE_MAX, 4)}
        </div>
      ))}
      <p className="note">Гид можно править под ваше событие: при выборе темы он подставляется из шаблона.</p>
      <SaveBar disabled={invalid} busy={busy} />
    </form>
  );
}
