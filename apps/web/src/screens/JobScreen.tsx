import { useEffect } from 'react';
import { postedLabel } from '../format.ts';
import { contactJob, useJob } from '../hooks/useJobs.ts';
import { useViewed } from '../hooks/useViewed.ts';

interface Props {
  id: string;
  city: string;
  onBack: (() => void) | null;
}

/** Карточка вакансии: кого ищут, кто нанимает, сколько платят и как написать работодателю. */
export function JobScreen({ id, city, onBack }: Props) {
  const { job, failed } = useJob(id);
  useViewed('job_viewed', id);
  useEffect(() => { if (job) document.title = `${job.title} — вакансия, ${city}, Я с вами`; }, [job, city]);

  if (!job) {
    return failed ? (
      <div className="state">
        <b>🫥</b>
        <p>{failed.message}</p>
        {onBack && <button className="chip" onClick={onBack}>← Все вакансии</button>}
      </div>
    ) : (
      <div className="state"><div className="spinner" role="status" aria-label="Загрузка" /></div>
    );
  }

  return (
    <>
      <div className={`hero${onBack ? '' : ' nb'}`}>
        {onBack && <button className="back" onClick={onBack}>← Все вакансии</button>}
        <small>{[city, 'вакансия'].join(' · ')}</small>
        <h1>{job.title}</h1>
      </div>

      <div className="group">
        <div className="meta">
          {job.employer && <div><span>🏢</span><span>{job.employer}</span></div>}
          <div><span>💰</span><span>{job.pay ?? 'оплата по договорённости'}</span></div>
          <div><span>🗓</span><span>Объявление от {postedLabel(job.posted_at)}</span></div>
        </div>
      </div>
      {job.description && <div className="group"><div className="meta"><div className="text">{job.description}</div></div></div>}
      <p className="note">Вакансия собрана из открытого чата о работе. Отвечает сам работодатель.</p>

      <div className="main"><div>
        <button className="cta" onClick={() => contactJob(job)}>Написать</button>
      </div></div>
    </>
  );
}
