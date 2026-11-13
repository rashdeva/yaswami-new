import { SendIcon } from 'lucide-react';
import type { Account, Conv } from '@/api';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { accountLabel, switchNote } from '@/lib/inbox';

/** С какого нашего аккаунта уйдёт сообщение в диалог и как это поменять (`useSendFrom`). */
export interface From {
  conversation: Conv;
  accounts: Account[];
  /** Выбранный аккаунт; undefined — писать не с чего. */
  account: string | undefined;
  onChange: (account: string) => void;
}

/** Как сказать в подтверждении отправки, с какого аккаунта уйдёт сообщение и что смена аккаунта — новый чат. */
export function fromText(from: From | undefined) {
  const label = from?.accounts.find((a) => a.id === from.account)?.label;
  if (!from || !label) return '';
  return ` Уйдёт с аккаунта «${label}». ${switchNote(from.conversation, from.accounts, from.account) ?? ''}`;
}

/** Выбор аккаунта Telegram, с которого писать человеку. Не вошедшие и сломанные видны, но выбрать их нельзя. У диалога с ботом выбора нет. */
export function AccountSelect({ conversation, accounts, account, onChange }: From) {
  if (conversation.channel === 'bot') return null;
  return (
    <Select value={account ?? ''} onValueChange={onChange}>
      <SelectTrigger size="sm" className="max-w-44 shrink-0" aria-label="С какого аккаунта писать" title="С какого аккаунта писать">
        {/* В поле — только подпись: состояние аккаунта видно в списке. */}
        <SendIcon className="text-muted-foreground" /><SelectValue placeholder="Нет аккаунта">{accountLabel(account, accounts)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {accounts.map((a) => (
          <SelectItem key={a.id} value={a.id} disabled={a.status !== 'active'}>
            {a.label}{a.status !== 'active' ? ' · не на связи' : a.last_error ? ` · ${a.last_error}` : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
