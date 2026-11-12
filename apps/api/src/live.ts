// Переписка в реальном времени для админки (`GET /admin/live`): кто сейчас пишет — агент готовит ответ или человек
// набирает сообщение, — и сигнал «в переписке новое», по которому админка перечитывает ленту, не дожидаясь опроса.
// Это мгновенное состояние: оно живёт в памяти процесса и в базу не пишется.
// ponytail: один процесс API; с несколькими экземплярами — рассылать через Postgres LISTEN/NOTIFY.
import type { AgentKey, Typing } from '@yaswami/core';

/** Telegram повторяет «печатает» каждые ~5 с, пока человек набирает; не повторил — перестал. */
export const USER_TYPING_MS = 6000;
/** Чаще админке слать незачем: агент пишет по токену, а глазу хватает четырёх обновлений в секунду. */
const FLUSH_MS = 250;

export type LiveEvent = { event: 'typing'; data: Typing[] } | { event: 'changed'; data: null };

const now = new Map<string, Typing>();
const expiry = new Map<string, NodeJS.Timeout>();
const listeners = new Set<(e: LiveEvent) => void>();
let pending: NodeJS.Timeout | undefined;
let typingChanged = false;
let changed = false;

const id = (conversation: string, who: Typing['who']) => `${conversation}:${who}`;

function flush() {
  pending = undefined;
  const events: LiveEvent[] = [
    ...(typingChanged ? [{ event: 'typing' as const, data: live.typing() }] : []),
    ...(changed ? [{ event: 'changed' as const, data: null }] : []),
  ];
  typingChanged = changed = false;
  for (const e of events) for (const listener of listeners) listener(e);
}
const later = () => void (pending ??= setTimeout(flush, FLUSH_MS).unref());

export const live = {
  typing: (): Typing[] => [...now.values()],
  /** Кто-то начал или продолжает писать. `ttlMs` — сам сойдёт, если не повторили (человек в Telegram). */
  start(t: Typing, ttlMs?: number) {
    const key = id(t.conversation_id, t.who);
    now.set(key, t);
    clearTimeout(expiry.get(key));
    if (ttlMs) expiry.set(key, setTimeout(() => live.stop(t.conversation_id, t.who), ttlMs).unref());
    typingChanged = true;
    later();
  },
  stop(conversation: string, who: Typing['who']) {
    const key = id(conversation, who);
    clearTimeout(expiry.get(key));
    expiry.delete(key);
    if (now.delete(key)) {
      typingChanged = true;
      later();
    }
  },
  /** В переписке новое: сообщение, черновик, пометка «ждёт вас». */
  changed() {
    changed = true;
    later();
  },
  subscribe(listener: (e: LiveEvent) => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
};

/** Агент готовит ответ в диалоге: пока идёт `run`, админка видит «пишет» и текст по мере готовности. */
export async function writing<T>(conversation: string, agent: AgentKey, run: (onText: (text: string) => void) => Promise<T>): Promise<T> {
  live.start({ conversation_id: conversation, who: 'agent', agent, text: null });
  try {
    return await run((text) => live.start({ conversation_id: conversation, who: 'agent', agent, text }));
  } finally {
    live.stop(conversation, 'agent');
  }
}
