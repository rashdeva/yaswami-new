// Выбор пользователя сервиса поиском по имени или @username: гость события, организатор нового события.
import type { User } from '@yaswami/core';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useUsers } from '@/hooks/useUsers';

export function UserPicker({ label, picked, onPick }: { label: string; picked?: User | null; onPick: (user: User) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { data, isFetching } = useUsers(open ? query.trim().replace(/^@/, '') : undefined);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="justify-start">{picked ? `${picked.first_name}${picked.username ? ` @${picked.username}` : ''}` : label}</Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="Имя или @username" />
          <CommandList>
            <CommandEmpty>{isFetching ? 'Ищу…' : 'Никого не нашлось'}</CommandEmpty>
            {data?.map((u) => (
              <CommandItem key={u.id} value={String(u.id)} onSelect={() => (onPick(u), setOpen(false))}>
                {u.first_name}{u.username && ` @${u.username}`}
                <CommandShortcut>{u.id}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
