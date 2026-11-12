import { useState } from 'react';
import { Input } from '@/components/ui/input';

/** Поле ответа человеку: Enter отправляет. `data-reply` — по нему поле находят горячие клавиши. */
export function Reply({ onSend, className }: { onSend: (text: string) => void; className?: string }) {
  const [text, setText] = useState('');
  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const value = text.trim();
        if (!value) return;
        setText('');
        (document.activeElement as HTMLElement | null)?.blur();
        onSend(value);
      }}
    >
      <Input data-reply value={text} onChange={(e) => setText(e.target.value)} placeholder="Ответить самому — Enter отправит, бот в этом диалоге замолчит" />
    </form>
  );
}
