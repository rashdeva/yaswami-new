import { AGENTS } from '@yaswami/core';
import { SparklesIcon } from 'lucide-react';
import type { Msg } from '@/api';
import type { From } from '@/components/AccountSelect';
import { AccountSelect, fromText } from '@/components/AccountSelect';
import { Hint } from '@/components/Page';
import { Confirm } from '@/components/Confirm';
import { ExternalLink } from '@/components/EntityLink';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupText, InputGroupTextarea } from '@/components/ui/input-group';
import { Kbd } from '@/components/ui/kbd';
import { agentOf, switchNote } from '@/lib/inbox';

interface Props {
  draft: Msg;
  /** Наша правка текста; undefined — текст агента без изменений. */
  text: string | undefined;
  onEdit: (text: string) => void;
  /** Сохранить правку, не отправляя: черновик остаётся ждать «Отправить». */
  onSave: (text: string) => void;
  onSend: () => void;
  onReject: () => void;
  /** Выбор аккаунта, с которого уйдёт черновик. */
  from?: From;
  className?: string;
}

/** Черновик агента: кто и почему предлагает, правка текста (сохраняется отдельно), отправить или отклонить. */
export function Draft({ draft, text, onEdit, onSave, onSend, onReject, from, className }: Props) {
  const edited = text !== undefined && text.trim() !== draft.text && !!text.trim();
  const agent = agentOf(draft.author);
  const note = from && switchNote(from.conversation, from.accounts, from.account);
  return (
    <div className={className}>
      <InputGroup className="border-dashed">
        <InputGroupAddon align="block-start" className="flex-wrap border-b border-dashed">
          <SparklesIcon />
          <span>
            {agent ? `Агент «${AGENTS[agent].name}»` : 'Агент'} предлагает {draft.meta?.reply_to ? 'ответить в чате' : 'написать'}
          </span>
          {draft.meta?.source_url && (
            <span className="ml-auto"><ExternalLink href={draft.meta.source_url} icon>сообщение</ExternalLink></span>
          )}
          {draft.meta?.reason && <span className="w-full">{draft.meta.reason}</span>}
        </InputGroupAddon>
        <InputGroupTextarea data-draft rows={2} className="max-h-60 min-h-0" value={text ?? draft.text} onChange={(e) => onEdit(e.target.value)} />
        <InputGroupAddon align="block-end" className="gap-1.5">
          {from && <AccountSelect {...from} />}
          <InputGroupText className="hidden sm:flex"><Kbd>E</Kbd> править</InputGroupText>
          <InputGroupButton variant="ghost" className="ml-auto" onClick={onReject}>Отклонить <Kbd>X</Kbd></InputGroupButton>
          {edited && <InputGroupButton variant="outline" onClick={() => onSave(text!.trim())}>Сохранить правку</InputGroupButton>}
          <Confirm
            title="Отправить черновик?" action="Отправить" destructive={false} onConfirm={onSend}
            description={`Сообщение уйдёт человеку в Telegram — вернуть его нельзя.${fromText(from)}`}
          >
            <InputGroupButton variant="default">Отправить <Kbd>Enter</Kbd></InputGroupButton>
          </Confirm>
        </InputGroupAddon>
      </InputGroup>
      {note && <Hint>{note}</Hint>}
    </div>
  );
}
