// «Агенты»: кто что делает и кому пишет.
import type { AgentKey } from '@yaswami/core';
import { AGENTS } from '@yaswami/core';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useOverview } from '@/hooks/useOverview';

export function AgentsScreen({ onShow }: { onShow: (agent: AgentKey) => void }) {
  const overview = useOverview();
  return (
    <div className="h-full overflow-y-auto p-5 pb-16">
      <h2 className="font-medium">Агенты</h2>
      <p className="mb-3 text-xs text-muted-foreground">Кто что делает и кому пишет. Агенты не отправляют сообщений первыми без вас: исключение — поддержка, она отвечает тем, кто сам написал боту.</p>
      {!overview && <p className="text-xs text-muted-foreground">Загружаю…</p>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {overview?.agents.map((a) => (
          <Card key={a.key}>
            <CardHeader>
              <CardTitle>{AGENTS[a.key].name}</CardTitle>
              <CardDescription>Когда отправляет: {AGENTS[a.key].sends}</CardDescription>
              <CardAction>
                {a.enabled ? <Badge variant="outline" className="border-green-600/40 text-green-700 dark:text-green-400">включён</Badge> : <Badge variant="secondary">выключен</Badge>}
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p>{AGENTS[a.key].about}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span><b className="text-foreground">{a.conversations}</b> диалогов</span>
                <span><b className="text-foreground">{a.drafts}</b> черновиков ждут</span>
                <span><b className="text-foreground">{a.sent_today}</b> отправлено за сутки</span>
                <span><b className="text-foreground">{a.sent}</b> всего</span>
              </div>
            </CardContent>
            <CardFooter>
              <Button variant="link" size="sm" className="px-0" onClick={() => onShow(a.key)}>Показать его диалоги</Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}
