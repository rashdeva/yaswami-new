import type { JobItem, Wire } from '@yaswami/core';
import { postedLabel } from '../format.ts';

/** Строка вакансии (Job): название, под ним — кто нанимает, оплата и дата объявления. Нажатие открывает карточку. */
export function JobRow({ job, onOpen }: { job: Wire<JobItem>; onOpen: () => void }) {
  return (
    <button className="plain job" onClick={onOpen}>
      <div className="guest">
        <div>{job.title}<small>{[job.employer, job.pay, postedLabel(job.posted_at)].filter(Boolean).join(' · ')}</small></div>
        <span>›</span>
      </div>
    </button>
  );
}
