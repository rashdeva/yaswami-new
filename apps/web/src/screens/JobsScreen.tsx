import { useEffect } from 'react';
import type { JobItem, Wire } from '@yaswami/core';
import { ProfileButton } from '../components/Avatar.tsx';
import { JobRow } from '../components/JobRow.tsx';
import { useJobs } from '../hooks/useJobs.ts';
import { useViewed } from '../hooks/useViewed.ts';

interface Props {
  city: string;
  onOpen: (job: Wire<JobItem>) => void;
}

/** Вкладка «Вакансии»: объявления работодателей города, свежие сверху. Открыта без входа. */
export function JobsScreen({ city, onOpen }: Props) {
  const { jobs, failed, more, loadingMore } = useJobs();
  useViewed('jobs_viewed');
  useEffect(() => { document.title = `Вакансии в городе ${city} — Я с вами`; }, [city]);

  return (
    <>
      <div className="top">
        <ProfileButton />
        <div className="head">
          <h1>Вакансии</h1>
          <p>📍 {city} · работа в городе</p>
        </div>
      </div>
      {failed && <div className="state"><b>🌧</b><p>{failed.message}</p></div>}
      {!jobs && !failed && <div className="state"><div className="spinner" role="status" aria-label="Загрузка" /></div>}
      {jobs?.length === 0 && <div className="state"><b>🌿</b><p>Вакансий пока нет. Загляните позже.</p></div>}
      {!!jobs?.length && (
        <>
          <div className="group jobs">
            {jobs.map((job) => <JobRow key={job.id} job={job} onOpen={() => onOpen(job)} />)}
          </div>
          {more && <div className="chips more"><button className="chip" disabled={loadingMore} onClick={more}>{loadingMore ? 'Загружаем…' : 'Показать ещё'}</button></div>}
          <p className="note">Вакансии собраны из открытых чатов о работе. Отвечает сам работодатель.</p>
        </>
      )}
    </>
  );
}
