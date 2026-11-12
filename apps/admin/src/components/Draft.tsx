import type { Msg } from '@/api';
import { Confirm } from '@/components/Confirm';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  draft: Msg;
  /** Наша правка текста; undefined — текст агента без изменений. */
  text: string | undefined;
  onEdit: (text: string) => void;
  /** Сохранить правку, не отправляя: черновик остаётся ждать «Отправить». */
  onSave: (text: string) => void;
  onSend: () => void;
  onReject: () => void;
  className?: string;
}

/** Черновик агента: причина, правка текста (сохраняется отдельно), отправить или отклонить. */
export function Draft({ draft, text, onEdit, onSave, onSend, onReject, className }: Props) {
  const edited = text !== undefined && text.trim() !== draft.text && !!text.trim();
  return (
    <div className={`flex flex-col gap-2 ${className ?? ''}`}>
      <p className="text-xs text-amber-700 dark:text-amber-400">
        Агент предлагает {draft.meta?.reply_to ? 'ответить в чате' : 'написать'}. {draft.meta?.reason}
        {draft.meta?.source_url && <> · <a className="underline" href={draft.meta.source_url} target="_blank" rel="noreferrer">открыть сообщение</a></>}
      </p>
      <Textarea data-draft rows={3} value={text ?? draft.text} onChange={(e) => onEdit(e.target.value)} />
      <div className="flex gap-2">
        <Confirm
          title="Отправить черновик?" action="Отправить" destructive={false} onConfirm={onSend}
          description="Сообщение уйдёт человеку в Telegram — вернуть его нельзя."
        >
          <Button size="sm">Отправить</Button>
        </Confirm>
        {edited && <Button size="sm" variant="outline" onClick={() => onSave(text!.trim())}>Сохранить правку</Button>}
        <Button size="sm" variant="outline" onClick={onReject}>Отклонить</Button>
      </div>
    </div>
  );
}
