// Переписка: лента, переписка одного диалога и действия над диалогом и черновиком.
import { useQuery } from '@tanstack/react-query';
import type { DraftSendInput, InboxSendInput } from '@yaswami/core';
import { useState } from 'react';
import { api, ApiError } from '../api.ts';
import type { Account, Conv } from '../api.ts';
import { sendFrom } from '../lib/inbox.ts';
import { keys } from './keys.ts';
import { useAct } from './useAct.ts';

// Опрос раз в 4 с — запасной путь: обычно ленту сразу перечитывает поток /admin/live (useLive.ts).
// ponytail: лента приходит целиком; когда диалогов станет много — отдавать только новое.
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
  const undoConv = (c: Conv) => ['conversation', c.id] as ['conversation', string];
  return {
    /** Сообщение человеку уходит в Telegram: не отменяется. */
    send: useAct(({ id, ...input }: { id: string } & InboxSendInput) => api.inboxSend(id, input)),
    /** Отправить черновик агента; `text` — наша правка, `account_id` — с какого аккаунта. Не отменяется. */
    sendDraft: useAct(({ id, ...input }: { id: string } & DraftSendInput) => api.draftSend(id, { ...input, text: input.text || undefined })),
    /** Сохранить правку черновика, не отправляя. */
    saveDraft: useAct(({ id, text }: { id: string; text: string }) => api.draftUpdate(id, text), { undo: ({ id }) => ['message', id] }),
    rejectDraft: useAct(api.draftReject, { undo: (id) => ['message', id] }),
    /** Взять диалог на себя или вернуть агенту; отметка «ждёт вас» снимается. */
    toggleMode: useAct((c: Conv) => api.inboxUpdate(c.id, { mode: c.mode === 'agent' ? 'human' : 'agent', attention: null }), { undo: undoConv }),
    done: useAct((c: Conv) => api.inboxUpdate(c.id, { attention: null }), { undo: undoConv }),
    /** Скрыть диалог, которому не отвечаем, или вернуть скрытый; скрытый вернётся и сам, когда человек напишет. */
    toggleHidden: useAct((c: Conv) => api.inboxUpdate(c.id, { is_hidden: !c.hidden_at }), { undo: undoConv }),
  };
}

/**
 * С какого аккаунта писать в каждый диалог: наш выбор на этом экране, иначе аккаунт диалога (`sendFrom`).
 * Возвращает функцию: диалог → то, что нужно `AccountSelect`.
 */
export function useSendFrom(accounts: Account[]) {
  const [chosen, setChosen] = useState<Record<string, string>>({}); // id диалога → id аккаунта
  return (conversation: Conv) => ({
    conversation, accounts, account: sendFrom(conversation, accounts, chosen[conversation.id]),
    onChange: (account: string) => setChosen({ ...chosen, [conversation.id]: account }),
  });
}
