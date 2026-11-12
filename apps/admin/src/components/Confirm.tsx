// Подтверждение действия: удаление и всё, что не вернуть (отправка, удаление аккаунта, отзыв токенов, заказ ролика).
import type { ReactNode } from 'react';
import { useRef } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

/** Подпись для отменяемого удаления. */
export const UNDO_HINT = 'Удаление можно отменить в «Журнале».';

interface Props {
  title: string;
  /** Что именно случится; для отменяемого — сказать, что его можно отменить в журнале. */
  description: ReactNode;
  /** Текст кнопки действия. */
  action?: string;
  destructive?: boolean;
  onConfirm: () => void;
  /** Кнопка, которая открывает диалог; без неё — управляемый диалог (`open`, `onOpenChange`). */
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Confirm({ title, description, action = 'Удалить', destructive = true, onConfirm, children, open, onOpenChange }: Props) {
  const ok = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {children && <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>}
      {/* Фокус на действии, а не на «Отмена»: из поля ответа Enter, Enter — отправить. */}
      <AlertDialogContent onOpenAutoFocus={(e) => (e.preventDefault(), ok.current?.focus())}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction ref={ok} variant={destructive ? 'destructive' : 'default'} onClick={onConfirm}>{action}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
