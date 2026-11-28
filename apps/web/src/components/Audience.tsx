import { useState } from 'react';
import type { Contact, Wire } from '@yaswami/core';
import { audienceCounts, audienceNote } from '../audience.ts';
import { plural } from '../found.ts';
import { GuestRow } from './GuestRow.tsx';

const PREVIEW = 3;

/** Организатору в профиле: гости его событий и клиенты его услуг; видит только он. */
export function Audience({ people }: { people: Wire<Contact>[] }) {
  const [all, setAll] = useState(false);
  if (!people.length) return null;
  const { guests, clients } = audienceCounts(people);
  const shown = all ? people : people.slice(0, PREVIEW);
  return (
    <>
      <div className="section-head"><h2>Гости и клиенты</h2><span>видите только вы</span></div>
      <div className="stats audience-stats">
        <div className="stat"><b>{guests}</b><span>{plural(guests, 'гость', 'гостя', 'гостей')} событий</span></div>
        <div className="stat"><b>{clients}</b><span>{plural(clients, 'клиент', 'клиента', 'клиентов')} услуг</span></div>
      </div>
      <div className="group audience">
        {shown.map((c) => (
          <GuestRow key={c.id} name={c.first_name} photo={null} sub={audienceNote(c)}>
            {c.username && <a className="write" href={`https://t.me/${c.username}`} target="_blank" rel="noreferrer">Написать</a>}
          </GuestRow>
        ))}
        {people.length > PREVIEW && !all && (
          <button type="button" className="row more" onClick={() => setAll(true)}>Все {people.length} {plural(people.length, 'человек', 'человека', 'человек')}</button>
        )}
      </div>
    </>
  );
}
