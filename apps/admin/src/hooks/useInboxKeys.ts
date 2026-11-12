// Горячие клавиши переписки: выбор строки, ответ, черновик, режим, «готово». Одни и те же в «Людях» и «Ленте».
import { useEffect } from 'react';
import type { Conv, Msg } from '../api.ts';
import { useConversationActions } from './useInbox.ts';

interface Options {
  rows: { key: string; c: Conv }[];
  /** Место выбранной строки в `rows`. */
  at: number;
  onSelect: (key: string) => void;
  /** Черновик агента в выбранном диалоге и наша правка его текста. */
  draft: Msg | undefined;
  draftText: string | undefined;
  /** CSS-селектор области, где лежат поле ответа (`data-reply`) и черновик (`data-draft`) выбранного диалога. */
  scope: string;
  /** O — открыть или закрыть переписку (только «Лента»). */
  onToggleThread?: () => void;
  /** Esc вне поля ввода. */
  onEscape?: () => void;
}

export function useInboxKeys({ rows, at, onSelect, draft, draftText, scope, onToggleThread, onEscape }: Options) {
  const { sendDraft, rejectDraft, toggleMode, done } = useConversationActions();
  const cur = rows[at];

  useEffect(() => {
    const focus = (selector: string) => document.querySelector<HTMLElement>(selector)?.focus();
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest<HTMLElement>('input, textarea');
      if (e.key === 'Escape') return typing ? typing.blur() : onEscape?.();
      // В черновике Enter — перенос строки, отправка — Cmd/Ctrl+Enter.
      if (typing?.tagName === 'TEXTAREA' && draft && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) return sendDraft({ id: draft.id, text: draftText });
      if (typing || !cur || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase(); // вторая буква — та же клавиша в русской раскладке
      if (e.key === 'ArrowDown' || key === 'j') onSelect(rows[Math.min(at + 1, rows.length - 1)]!.key);
      else if (e.key === 'ArrowUp' || key === 'k') onSelect(rows[Math.max(at - 1, 0)]!.key);
      else if (e.key === 'Enter' && draft) sendDraft({ id: draft.id, text: draftText });
      else if ((key === 'x' || key === 'ч') && draft) rejectDraft(draft.id);
      else if ((key === 'e' || key === 'у') && draft) focus(`${scope} [data-draft]`);
      else if (e.key === 'Enter' || key === 'r' || key === 'к') focus(`${scope} [data-reply]`);
      else if (key === 't' || key === 'е') toggleMode(cur.c);
      else if (key === 'd' || key === 'в') done(cur.c);
      else if ((key === 'o' || key === 'щ') && onToggleThread) onToggleThread();
      else if (e.key === '/') focus('[data-search]');
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  // Выбранная строка всегда на виду.
  useEffect(() => {
    document.querySelector('[data-selected=true]')?.scrollIntoView({ block: 'nearest' });
  }, [cur?.key]);
}
