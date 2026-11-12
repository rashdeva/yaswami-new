import { ArrowUpIcon } from 'lucide-react';
import { useState } from 'react';
import { Confirm } from '@/components/Confirm';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupText, InputGroupTextarea } from '@/components/ui/input-group';
import { Kbd } from '@/components/ui/kbd';

/**
 * Поле ответа человеку: Enter спрашивает подтверждение (фокус на «Отправить» — второй Enter отправит), Shift+Enter — перенос строки.
 * `data-reply` — по нему поле находят горячие клавиши.
 */
export function Reply({ onSend, className }: { onSend: (text: string) => void; className?: string }) {
  const [text, setText] = useState('');
  const [asking, setAsking] = useState(false);
  const ask = () => text.trim() && setAsking(true);
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
          <InputGroupText className="min-w-0 truncate">
            <Kbd>Enter</Kbd> отправить <Kbd className="ml-1">Shift+Enter</Kbd> перенос
          </InputGroupText>
          <InputGroupButton type="submit" variant="default" size="icon-xs" className="ml-auto rounded-full" disabled={!text.trim()}>
            <ArrowUpIcon />
            <span className="sr-only">Отправить</span>
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <Confirm
        open={asking} onOpenChange={setAsking} title="Отправить сообщение?" action="Отправить" destructive={false}
        description={<>Уйдёт человеку в Telegram — вернуть его нельзя. Бот в этом диалоге замолчит.<span className="mt-2 block whitespace-pre-wrap text-foreground">{text.trim()}</span></>}
        onConfirm={() => {
          onSend(text.trim());
          setText('');
        }}
      />
    </form>
  );
}
