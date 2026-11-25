// Источники анонсов по календарям: список, добавить канал, включить или выключить, перенести в другой календарь;
// календарю — имя, вид и организатор. Действия отменяются из тоста.
import { useQuery } from '@tanstack/react-query';
import type { CalendarUpdateInput, SourceUpdateInput } from '@yaswami/core';
import { api } from '../api.ts';
import { keys } from './keys.ts';
import { useAct } from './useAct.ts';

const undo = (_input: unknown, source: { channel: string }) => ['source', source.channel] as ['source', string];
const undoCalendar = (_input: unknown, calendar: { id: string }) => ['calendar', calendar.id] as ['calendar', string];

export function useSources() {
  return {
    calendars: useQuery({ queryKey: keys.calendars, queryFn: api.calendars }),
    create: useAct(api.sourceCreate, { undo }),
    update: useAct(({ channel, ...input }: { channel: string } & SourceUpdateInput) => api.sourceUpdate(channel, input), { undo }),
    updateCalendar: useAct(({ id, ...input }: { id: string } & CalendarUpdateInput) => api.calendarUpdate(id, input), { undo: undoCalendar }),
  };
}
