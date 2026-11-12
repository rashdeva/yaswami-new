// «События»: модерация собранных событий. Новое событие ждёт решения; одобренное проходит обработку (обложка и ролик)
// и выходит в ленту; опубликованное можно снять или удалить.
import type { AdminCollectedEvent, CollectedStatus } from '@yaswami/core';
import { collectedPath, collectedWhen } from '@yaswami/core';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useCollectedEvents, useModeration } from '@/hooks/useCollectedEvents';

const GROUPS: { status: CollectedStatus; title: string; hint: string }[] = [
  { status: 'pending', title: 'Ждут решения', hint: 'Сборщик разобрал анонс. В ленте события нет, пока вы его не одобрите.' },
  { status: 'approved', title: 'Обрабатываются', hint: 'Одобрены: иллюстратор делает обложку и ролик, после этого событие само выйдет в ленту.' },
  { status: 'published', title: 'В ленте', hint: 'Видны всем. Событие можно снять с публикации или удалить.' },
  { status: 'rejected', title: 'Отклонены', hint: 'Не выводятся нигде. Остаются в базе, чтобы повторный анонс не создал событие заново.' },
];

export function EventsScreen() {
  const items = useCollectedEvents();
  const { moderate, remove } = useModeration();

  const card = (e: AdminCollectedEvent) => (
    <Card key={e.id} size="sm">
      <CardContent className="flex items-start gap-3">
        {e.cover_url
          ? <img className="aspect-9/16 w-21 flex-none rounded-lg bg-muted object-cover" src={e.cover_url} alt="" loading="lazy" />
          : <div className="flex aspect-9/16 w-21 flex-none items-center justify-center rounded-lg bg-muted text-[11px] text-muted-foreground">нет фото</div>}
        <div className="flex min-w-0 flex-col gap-1.5">
          <strong>{e.title}</strong>
          <div className="text-xs text-muted-foreground">{[collectedWhen(e.starts_at), e.place, e.price].filter(Boolean).join(' · ')}</div>
          <div className="text-xs text-muted-foreground">{[e.topic, `источник: ${e.channel}`, e.video_url && 'есть ролик'].filter(Boolean).join(' · ')}</div>
          {e.description && <p className="line-clamp-4 text-xs whitespace-pre-wrap">{e.description}</p>}
          <div className="flex flex-wrap gap-3 text-xs">
            <a className="underline" href={e.source_url} target="_blank" rel="noreferrer">исходный анонс</a>
            {/* Страница события — на сайте, вне админки: обычная ссылка, не маршрут. */}
            {e.status === 'published' && <a className="underline" href={collectedPath(e.id)} target="_blank" rel="noreferrer">страница события</a>}
          </div>
          <div className="flex flex-wrap gap-2">
            {(e.status === 'pending' || e.status === 'rejected') && <Button size="sm" onClick={() => moderate({ id: e.id, status: 'approved' })}>Одобрить</Button>}
            {e.status !== 'rejected' && (
              <Button size="sm" variant="outline" onClick={() => moderate({ id: e.id, status: 'rejected' })}>{e.status === 'pending' ? 'Отклонить' : 'Снять с публикации'}</Button>
            )}
            {e.status !== 'pending' && (
              <Button size="sm" variant="outline" onClick={() => confirm(`Удалить «${e.title}» совсем? Повторный анонс создаст событие заново.`) && remove(e.id)}>Удалить</Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="h-full overflow-y-auto p-5 pb-16">
      <h2 className="font-medium">События</h2>
      {!items && <p className="text-xs text-muted-foreground">Загружаю…</p>}
      {items && GROUPS.map(({ status, title, hint }) => {
        const list = items.filter((e) => e.status === status);
        // Пустые «обрабатываются» и «отклонены» не показываем; «ждут решения» — всегда, чтобы было видно, что очередь пуста.
        if (!list.length && status !== 'pending') return null;
        return (
          <section key={status} className="mt-4">
            <h3 className="flex items-center gap-2 text-sm font-medium">{title} <Badge>{list.length}</Badge></h3>
            <p className="mb-2 text-xs text-muted-foreground">{list.length ? hint : 'Новых событий нет.'}</p>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{list.map(card)}</div>
          </section>
        );
      })}
    </div>
  );
}
