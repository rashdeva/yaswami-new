import type { Guide } from '@yaswami/core';

interface Props {
  topic?: string | null;
  what_happens?: string[];
  for_whom?: string | null;
  beginner_friendly?: boolean | null;
  takeaway?: string | null;
  guide?: Guide | null;
  /** Подпись под гидом: у собранного события гид — шаблон редакции, у события Ясвами его правит организатор. */
  guideNote?: string;
}

/** «Что будет», «Для кого», «С чем уйдёшь» и гид по формату: одинаково у собранного события и у события Ясвами. */
export function About({ topic, what_happens, for_whom, beginner_friendly, takeaway, guide, guideNote }: Props) {
  const level = beginner_friendly == null ? null : beginner_friendly ? 'Можно без опыта' : 'Нужен опыт';
  return (
    <>
      {!!what_happens?.length && (
        <>
          <h2>Что будет</h2>
          <div className="group"><ol className="steps">{what_happens.map((s) => <li key={s}><span>{s}</span></li>)}</ol></div>
        </>
      )}
      {(for_whom || level) && (
        <>
          <h2>Для кого</h2>
          <div className="group"><div className="pad">
            {for_whom && <p>{for_whom}</p>}
            {level && <span className={`badge${beginner_friendly ? '' : ' no'}`}>{level}</span>}
          </div></div>
        </>
      )}
      {takeaway && (
        <>
          <h2>С чем уйдёшь</h2>
          <div className="group"><div className="pad"><p className="quote">{takeaway}</p><p className="from">Со слов организатора</p></div></div>
        </>
      )}
      {guide && (
        <>
          <h2 className="cap">{topic ? `${topic} — что это` : 'Что это'}</h2>
          <div className="group">
            <div className="pad"><p>{guide.what}</p><p>{guide.why}</p></div>
            {guide.first && <details><summary>Если идёшь впервые</summary><p>{guide.first}</p></details>}
            {guide.not_for && <details><summary>Кому стоит быть осторожнее</summary><p>{guide.not_for}</p></details>}
          </div>
          {guideNote && <p className="note">{guideNote}</p>}
        </>
      )}
    </>
  );
}
