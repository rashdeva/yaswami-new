// Переписка: лента, переписка одного диалога и действия над диалогом и черновиком.
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../api.ts';
import type { Conv } from '../api.ts';
import { keys } from './keys.ts';
import { useAct } from './useAct.ts';

// ponytail: опрос раз в 4 секунды; когда диалогов станет много — отдавать только новое или перейти на SSE.
const POLL_MS = 4000;

let seen: Set<string> | null = null; // сообщения первой загрузки: остальные «Лента» подсвечивает
/** Сообщение пришло уже после того, как админку открыли. */
export const isFresh = (message: string) => seen !== null && !seen.has(message);

/** Лента и код ошибки загрузки: `unauthorized` — не вошёл, `forbidden` — не админ, остальное — нет связи. */
export function useInbox() {
  const { data, error } = useQuery({
    queryKey: keys.inbox,
    queryFn: async () => {
      const feed = await api.inbox();
      seen ??= new Set(feed.messages.map((m) => m.id));
      return feed;
    },
    refetchInterval: POLL_MS,
  });
  return { feed: data, problem: error ? (error instanceof ApiError ? error.code : 'internal') : null };
}

/** Лента для экранов: App не рисует их, пока она не загружена. */
export const useFeed = () => useInbox().feed!;

/** Вся переписка диалога; без диалога — пусто. */
export function useThread(conversation: string | undefined) {
  const { data } = useQuery({
    queryKey: keys.thread(conversation ?? ''),
    queryFn: () => api.inboxThread(conversation!),
    enabled: !!conversation,
    refetchInterval: POLL_MS,
  });
  return data ?? [];
}

export function useConversationActions() {
  return {
    send: useAct(({ id, text }: { id: string; text: string }) => api.inboxSend(id, text)),
    /** Отправить черновик агента; `text` — наша правка. */
    sendDraft: useAct(({ id, text }: { id: string; text?: string }) => api.draftSend(id, text)),
    rejectDraft: useAct(api.draftReject),
    /** Взять диалог на себя или вернуть агенту; отметка «ждёт вас» снимается. */
    toggleMode: useAct((c: Conv) => api.inboxUpdate(c.id, { mode: c.mode === 'agent' ? 'human' : 'agent', attention: null })),
    done: useAct((c: Conv) => api.inboxUpdate(c.id, { attention: null })),
  };
}
