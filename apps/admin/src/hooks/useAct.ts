// Действие админа и его отмена: тост при ошибке, тост «Отменить» после отменяемого, после — перечитать данные.
import type { QueryClient } from '@tanstack/react-query';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AdminEntity } from '@yaswami/core';
import { toast } from 'sonner';
import { api } from '../api.ts';
import type { Feed } from '../api.ts';
import { actionLabel } from '../lib/journal.ts';
import { keys } from './keys.ts';

/** Сколько висит тост с «Отменить» / «Вернуть»: умолчания sonner (4 с) не хватает, чтобы прочитать и нажать. */
const UNDO_MS = 10_000;

interface Options<Input, Result> {
  /** Ответ сервера — в кэш, где он полный (до перечитывания). */
  onSuccess?: (result: Result, input: Input) => void;
  /** Действие отменяемое: над какой сущностью оно было — по ней находим строку журнала для тоста «Отменить». */
  undo?: (input: Input, result: Result) => [AdminEntity, string];
}

/**
 * Действие админа: ошибку показываем тостом, после любого исхода перечитываем всё — затронутую запись, списки
 * и журнал (данных в админке немного). Возвращает `mutate`: вторым аргументом — свои onSuccess/onError на вызов.
 */
export function useAct<Input, Result>(action: (input: Input) => Promise<Result>, options: Options<Input, Result> = {}) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: action,
    onSuccess: (result, input) => {
      options.onSuccess?.(result, input);
      if (options.undo) void offerUndo(client, ...options.undo(input, result));
    },
    onError: (e) => void toast.error(e.message),
    onSettled: () => client.invalidateQueries(),
  }).mutate;
}

/**
 * Тост «Отменить» после действия. Сервер не возвращает id строки журнала в ответе, поэтому берём последнюю строку
 * журнала по этой сущности от текущего админа: её только что записала та же транзакция.
 */
async function offerUndo(client: QueryClient, entity: AdminEntity, entity_id: string) {
  const me = client.getQueryData<Feed>(keys.inbox)?.me;
  const last = await api.actions({ entity, entity_id, actor_id: me, pagination_limit: 1 }).then((r) => r.entries[0], () => undefined);
  if (!last) return;
  const label = actionLabel(last.action);
  if (!last.undoable || last.undone_by) return void toast.success(label);
  toast.success(label, { duration: UNDO_MS, action: { label: 'Отменить', onClick: () => void undo(client, last.id, label) } });
}

/**
 * Отменить действие журнала. Не привязано к компоненту: тост живёт дольше экрана, с которого его показали.
 * После отмены — тост «Вернуть»: это отмена отмены.
 */
async function undo(client: QueryClient, id: string, label?: string) {
  try {
    const done = await api.actionUndo(id);
    toast.success(label ? `Отменено: ${label}` : 'Отменено', { duration: UNDO_MS, action: { label: 'Вернуть', onClick: () => void undo(client, done.id) } });
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    void client.invalidateQueries();
  }
}

/** Отменить действие по id строки журнала — для журнала и блока «История». */
export function useUndo() {
  const client = useQueryClient();
  return (id: string, label?: string) => void undo(client, id, label);
}
