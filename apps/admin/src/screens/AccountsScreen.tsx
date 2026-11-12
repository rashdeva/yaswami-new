// «Аккаунты»: аккаунты Telegram, с которых мы пишем людям, — добавить, пройти вход по шагам, переименовать, удалить.
import { CircleAlertIcon, PencilIcon } from 'lucide-react';
import { useState } from 'react';
import type { Account } from '@/api';
import { Confirm } from '@/components/Confirm';
import { History } from '@/components/History';
import { Hint, Nothing, Page } from '@/components/Page';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { useAccounts } from '@/hooks/useAccounts';
import { useFeed } from '@/hooks/useInbox';

const LOGIN_STEP: Partial<Record<Account['status'], string>> = {
  login_requested: 'Запрашиваем код у Telegram…',
  login_code: 'Введите код, который пришёл в Telegram на этот номер',
  login_password: 'Введите пароль двухэтапной проверки',
};

/** Название аккаунта: по клику — поле, Enter сохраняет, Esc — отмена. */
function Label({ a, onRename }: { a: Account; onRename: (label: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  if (text === null) {
    return <span className="flex items-center gap-1">{a.label}<Button size="icon-xs" variant="ghost" aria-label="Переименовать" onClick={() => setText(a.label)}><PencilIcon /></Button></span>;
  }
  return (
    <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), text.trim() && text.trim() !== a.label && onRename(text.trim()), setText(null))}>
      <Input autoFocus value={text} maxLength={40} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setText(null)} />
      <Button size="sm">Сохранить</Button>
    </form>
  );
}

export function AccountsScreen() {
  const { accounts } = useFeed();
  const { create, rename, login, remove } = useAccounts();
  const [label, setLabel] = useState('');
  const [phone, setPhone] = useState('');
  const [secrets, setSecrets] = useState<Record<string, string>>({}); // код или пароль по id аккаунта

  return (
    <Page title="Аккаунты Telegram">
      <div className="flex max-w-xl flex-col gap-3">
        {accounts.length === 0 && <Nothing title="Пока нет ни одного" hint="Нужен отдельный, не личный номер: аккаунт могут заблокировать." />}
        {accounts.map((a) => (
          <Card key={a.id} size="sm">
            <CardHeader>
              <CardTitle><Label a={a} onRename={(l) => rename({ id: a.id, label: l })} /></CardTitle>
              <CardDescription>{a.phone}</CardDescription>
              <CardAction>
                {a.status === 'active' ? <Badge>На связи</Badge>
                  : a.status === 'error' ? <Badge variant="destructive">Ошибка входа</Badge>
                  : <Badge variant="secondary">Идёт вход</Badge>}
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {LOGIN_STEP[a.status] && <Hint>{LOGIN_STEP[a.status]}</Hint>}
              {a.last_error && <Alert variant="destructive"><CircleAlertIcon /><AlertDescription>{a.last_error}</AlertDescription></Alert>}
              {(a.status === 'login_code' || a.status === 'login_password') && (
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const secret = secrets[a.id]?.trim();
                    if (!secret) return;
                    setSecrets({ ...secrets, [a.id]: '' });
                    login({ id: a.id, secret });
                  }}
                >
                  <Input
                    type={a.status === 'login_password' ? 'password' : 'text'} autoComplete="off" value={secrets[a.id] ?? ''}
                    onChange={(e) => setSecrets({ ...secrets, [a.id]: e.target.value })} placeholder={a.status === 'login_code' ? 'Код из Telegram' : 'Пароль'}
                  />
                  <Button>Отправить</Button>
                </form>
              )}
              <Collapsible>
                <div className="flex items-center gap-2">
                  <Confirm
                    title={`Удалить аккаунт «${a.label}»?`}
                    description="Сессия Telegram удалится — это не отменить, войти придётся заново с кодом. Переписка останется, но писать в неё будет не с чего."
                    onConfirm={() => remove(a.id)}
                  >
                    <Button variant="destructive" size="sm">Удалить</Button>
                  </Confirm>
                  <CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="ml-auto">История</Button></CollapsibleTrigger>
                </div>
                <CollapsibleContent className="mt-2"><History entity="account" id={a.id} /></CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>
        ))}
        <form
          className="flex flex-wrap gap-2 sm:flex-nowrap"
          onSubmit={(e) => {
            e.preventDefault();
            create({ label: label.trim(), phone: phone.replace(/[\s()-]/g, '') }, { onSuccess: () => (setLabel(''), setPhone('')) });
          }}
        >
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Название, например «Аня»" required maxLength={40} />
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+84 …" required inputMode="tel" />
          <Button>Добавить</Button>
        </form>
      </div>
    </Page>
  );
}
