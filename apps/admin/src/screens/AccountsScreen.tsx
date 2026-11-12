// «Аккаунты»: аккаунты Telegram, с которых мы пишем людям, — добавить, пройти вход по шагам, удалить.
import { useState } from 'react';
import type { Account } from '@/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAccounts } from '@/hooks/useAccounts';
import { useFeed } from '@/hooks/useInbox';

const LOGIN_STEP: Partial<Record<Account['status'], string>> = {
  login_requested: 'Запрашиваем код у Telegram…',
  login_code: 'Введите код, который пришёл в Telegram на этот номер',
  login_password: 'Введите пароль двухэтапной проверки',
};

export function AccountsScreen() {
  const { accounts } = useFeed();
  const { create, login, remove } = useAccounts();
  const [label, setLabel] = useState('');
  const [phone, setPhone] = useState('');
  const [secrets, setSecrets] = useState<Record<string, string>>({}); // код или пароль по id аккаунта

  return (
    <div className="h-full overflow-y-auto p-5 pb-16">
      <div className="flex max-w-xl flex-col gap-3">
        <h2 className="font-medium">Аккаунты Telegram</h2>
        {accounts.length === 0 && <p className="text-xs text-muted-foreground">Пока нет ни одного. Нужен отдельный, не личный номер: аккаунт могут заблокировать.</p>}
        {accounts.map((a) => (
          <Card key={a.id} size="sm">
            <CardHeader>
              <CardTitle>{a.label}</CardTitle>
              <CardDescription>{a.phone}</CardDescription>
              <CardAction>
                {a.status === 'active' ? <Badge variant="outline" className="border-green-600/40 text-green-700 dark:text-green-400">На связи</Badge>
                  : a.status === 'error' ? <Badge variant="destructive">Ошибка входа</Badge>
                  : <Badge variant="secondary">Идёт вход</Badge>}
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {LOGIN_STEP[a.status] && <p className="text-xs text-muted-foreground">{LOGIN_STEP[a.status]}</p>}
              {a.last_error && <p className="text-xs text-amber-700 dark:text-amber-400">{a.last_error}</p>}
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
              <Button
                variant="link" size="sm" className="self-start px-0 text-destructive"
                onClick={() => confirm(`Удалить аккаунт «${a.label}»? Его переписка останется, но писать в неё будет не с чего.`) && remove(a.id)}
              >
                Удалить
              </Button>
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
    </div>
  );
}
