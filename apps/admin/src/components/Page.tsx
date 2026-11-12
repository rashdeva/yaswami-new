// Каркас раздела и карточки: заголовок с действиями, загрузка, пустое состояние, подгрузка ленты.
import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';

/** Каркас раздела: заголовок, пояснение под ним, действия справа. Типографика заголовков живёт только здесь. */
export function Page({ title, description, actions, children }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto p-5 pb-16">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <header className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="flex min-w-0 flex-wrap items-center gap-2 font-medium">{title}</h2>
            {description && <Hint>{description}</Hint>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
        {children}
      </div>
    </div>
  );
}

/** Мелкое пояснение: пустой список, подсказка под полем, сноска. */
export const Hint = ({ children }: { children: ReactNode }) => <p className="text-xs text-muted-foreground">{children}</p>;

/** Блок карточки сущности: «Поля», «Гости», «История»… */
export function Section({ title, description, actions, children }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {actions && <CardAction className="flex flex-wrap gap-2">{actions}</CardAction>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Скелетон списка или карточки, пока данные грузятся. */
export function Loading({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}
    </div>
  );
}

export function Nothing({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        {hint && <EmptyDescription>{hint}</EmptyDescription>}
      </EmptyHeader>
      {children}
    </Empty>
  );
}

/** Ошибка загрузки карточки: чаще всего запись удалили. */
export const Failed = ({ error }: { error: Error }) => <Nothing title="Не получилось загрузить" hint={error.message} />;

/** Подгрузить следующую страницу, когда низ списка показался на экране; кнопка — если наблюдатель не сработал. */
export function LoadMore({ more, loading, onMore }: { more: boolean; loading: boolean; onMore: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!more || loading || !ref.current) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && onMore());
    io.observe(ref.current);
    return () => io.disconnect();
  }, [more, loading, onMore]);
  if (!more) return null;
  return (
    <div ref={ref} className="flex justify-center py-2">
      <Button variant="outline" size="sm" disabled={loading} onClick={onMore}>{loading ? 'Загружаю…' : 'Показать ещё'}</Button>
    </div>
  );
}
