// Выбор организатора из уже загруженного списка поиском по имени, @username или каналу: организатор источника.
import type { Host, Wire } from '@yaswami/core';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface Props {
  label: string;
  hosts: Wire<Host>[];
  /** Организатор уже указан: в списке появляется «Убрать организатора». */
  picked: boolean;
  onPick: (host: Wire<Host> | null) => void;
}

export function HostPicker({ label, hosts, picked, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const pick = (host: Wire<Host> | null) => (onPick(host), setOpen(false));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="xs" variant="outline">{label}</Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder="Имя, @username или канал" />
          <CommandList>
            <CommandEmpty>Никого не нашлось</CommandEmpty>
            {picked && <CommandItem value="убрать организатора" onSelect={() => pick(null)}>Убрать организатора</CommandItem>}
            {hosts.map((h) => (
              <CommandItem key={h.id} value={`${h.name} @${h.username}`} keywords={h.channel ? [h.channel] : undefined} onSelect={() => pick(h)}>
                {h.name}
                <CommandShortcut>@{h.username}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
