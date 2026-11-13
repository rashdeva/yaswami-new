import { ArrowUpIcon } from 'lucide-react';
import { useState } from 'react';
import type { From } from '@/components/AccountSelect';
import { AccountSelect, fromText } from '@/components/AccountSelect';
import { Confirm } from '@/components/Confirm';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupText, InputGroupTextarea } from '@/components/ui/input-group';
import { Kbd } from '@/components/ui/kbd';
import { Hint } from '@/components/Page';
import { switchNote } from '@/lib/inbox';

/**
 * Поле ответа человеку: Enter спрашивает подтверждение (фокус на «Отправить» — второй Enter отправит), Shift+Enter — перенос строки.
 * `onSend` получает текст и `sent` — её зовут, когда сообщение принято: тогда поле очищается.
 * `data-reply` — по нему поле находят горячие клавиши. `from` — выбор аккаунта, с которого уйдёт сообщение.
 */
export function Reply({ onSend, from, className }: { onSend: (text: string, sent: () => void) => void; from?: From; className?: string }) {
  const [text, setText] = useState('');
  const [asking, setAsking] = useState(false);
  const ask = () => text.trim() && setAsking(true);
  const note = from && switchNote(from.conversation, from.accounts, from.account);
  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        ask();
      }}
    >
      <InputGroup>
        <InputGroupTextarea
          data-reply rows={1} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ответить самому — бот в этом диалоге замолчит" className="max-h-40 min-h-0"
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            ask();
          }}
        />
        <InputGroupAddon align="block-end">
          {from && <AccountSelect {...from} />}
          <InputGroupText className="min-w-0 truncate">
            <Kbd>Enter</Kbd> отправить <Kbd className="ml-1">Shift+Enter</Kbd> перенос
          </InputGroupText>
          <InputGroupButton type="submit" variant="default" size="icon-xs" className="ml-auto rounded-full" disabled={!text.trim()}>
            <ArrowUpIcon />
            <span className="sr-only">Отправить</span>
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {note && <Hint>{note}</Hint>}
      <Confirm
        open={asking} onOpenChange={setAsking} title="Отправить сообщение?" action="Отправить" destructive={false}
        description={<>Уйдёт человеку в Telegram — вернуть его нельзя. Бот в этом диалоге замолчит.{fromText(from)}<span className="mt-2 block whitespace-pre-wrap text-foreground">{text.trim()}</span></>}
        onConfirm={() => {
          // Поле чистим, только когда сервер принял сообщение: при отказе (лимит, аккаунт не на связи) текст остаётся.
          onSend(text.trim(), () => setText(''));
        }}
      />
    </form>
  );
}
