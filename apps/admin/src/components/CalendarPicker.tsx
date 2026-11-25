// Выбор календаря из уже загруженного списка поиском по имени или каналу: куда перенести источник (склеить Telegram
// и Instagram одной вывески) или отделить его в свой календарь.
import type { AdminCalendar, Wire } from '@yaswami/core';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { sourcePlatform } from '@/lib/catalog';

interface Props {
  calendars: Wire<AdminCalendar>[];
  /** Календарь, где источник сейчас: его в списке нет. */
  current: string;
  /** В календаре источник не один: в списке появляется «В отдельный календарь». */
  canSplit: boolean;
  /** null — отделить в новый свой календарь. */
  onPick: (calendarId: string | null) => void;
}

export function CalendarPicker({ calendars, current, canSplit, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const pick = (id: string | null) => (onPick(id), setOpen(false));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="xs" variant="outline">Перенести</Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <Command>
          <CommandInput placeholder="Календарь или канал" />
          <CommandList>
            <CommandEmpty>Ничего не нашлось</CommandEmpty>
            {canSplit && <CommandItem value="в отдельный календарь" onSelect={() => pick(null)}>В отдельный календарь</CommandItem>}
            {calendars.filter((c) => c.id !== current).map((c) => (
              <CommandItem key={c.id} value={`${c.name} ${c.id}`} keywords={c.sources.map((s) => s.channel)} onSelect={() => pick(c.id)}>
                {c.name}
                <CommandShortcut>{c.sources.map((s) => sourcePlatform(s.channel)).join(', ')}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
