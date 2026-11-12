import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

/** Действие админа: ошибку показываем тостом, после любого исхода перечитываем всё — данных в админке немного. */
export function useAct<Input>(action: (input: Input) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: action,
    onError: (e) => void toast.error(e.message),
    onSettled: () => client.invalidateQueries(),
  }).mutate;
}
