// Аудитория организатора в профиле: кто гость, кто клиент и что о нём сказать одной строкой. Экран только рисует.
import type { Contact, Wire } from '@yaswami/core';
import { plural } from './found.ts';

type Person = Wire<Contact>;

/** Клиент — записался хотя бы на одну услугу; остальные — гости событий. */
export const isClient = (c: Pick<Person, 'practices'>) => c.practices.length > 0;

/** Строка под именем: чем человек связан с организатором. */
export function audienceNote(c: Pick<Person, 'practices' | 'event_approved_count' | 'event_pending_count'>): string {
  const events = (n: number) => `${n} ${plural(n, 'событие', 'события', 'событий')}`;
  // Формы без рода: пол человека мы не знаем.
  if (isClient(c)) return `клиент · «${c.practices[0]}»${c.practices.length > 1 ? ` и ещё ${c.practices.length - 1}` : ''}`;
  if (c.event_approved_count > 0) return `гость · идёт на ${events(c.event_approved_count)}`;
  if (c.event_pending_count > 0) return `гость · запись на ${events(c.event_pending_count)}`;
  return 'заходит на ваши события';
}

export const audienceCounts = (people: Pick<Person, 'practices'>[]) => {
  const clients = people.filter(isClient).length;
  return { guests: people.length - clients, clients };
};
