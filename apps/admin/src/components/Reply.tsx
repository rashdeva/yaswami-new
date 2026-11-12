import { useState } from 'react';
import { Confirm } from '@/components/Confirm';
import { Input } from '@/components/ui/input';

/**
 * Поле ответа человеку: Enter спрашивает подтверждение (фокус на «Отправить» — второй Enter отправит).
 * `data-reply` — по нему поле находят горячие клавиши.
 */
export function Reply({ onSend, className }: { onSend: (text: string) => void; className?: string }) {
  const [text, setText] = useState('');
  const [asking, setAsking] = useState(false);
  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) setAsking(true);
      }}
    >
      <Input data-reply value={text} onChange={(e) => setText(e.target.value)} placeholder="Ответить самому — Enter отправит, бот в этом диалоге замолчит" />
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
