// Поле поиска: лупа слева, подсказка клавиши справа. Пропсы — как у input.
import { SearchIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Kbd } from '@/components/ui/kbd';

export function Search({ kbd, className, ...props }: ComponentProps<typeof InputGroupInput> & { kbd?: string }) {
  return (
    <InputGroup className={className}>
      <InputGroupAddon><SearchIcon /></InputGroupAddon>
      <InputGroupInput type="search" {...props} />
      {kbd && <InputGroupAddon align="inline-end"><Kbd>{kbd}</Kbd></InputGroupAddon>}
    </InputGroup>
  );
}
