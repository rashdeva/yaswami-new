// Колонка действий строки таблицы: последняя и прилипает к правому краю — кнопки видны, даже когда таблица
// шире экрана и прокручивается вбок. Вид колонки действий живёт только здесь.
import type { ComponentProps } from 'react';
import { TableCell, TableHead } from '@/components/ui/table';
import { cn } from '@/lib/utils';

// Фон непрозрачный (иначе под кнопками просвечивают соседние колонки) и повторяет подсветку строки под курсором.
// Линия слева — тенью: рамка ячейки при border-collapse не прилипает вместе с ней.
const STICKY = 'sticky right-0 w-px bg-background shadow-[-1px_0_0_var(--border)] in-data-[slot=card]:bg-card';

/** Заголовок колонки действий: пустой. */
export const ActionsHead = () => <TableHead className={STICKY} />;

/** Ячейка с кнопками строки. `className` — только выравнивание по вертикали (`align-top`). */
export function ActionsCell({ className, children, ...props }: ComponentProps<typeof TableCell>) {
  return (
    <TableCell className={cn(STICKY, '[tr:hover>&]:bg-linear-to-r [tr:hover>&]:from-muted/50 [tr:hover>&]:to-muted/50', className)} {...props}>
      <div className="flex items-center justify-end gap-1">{children}</div>
    </TableCell>
  );
}
