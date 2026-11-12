// «Агенты»: кто что делает и кому пишет.
import type { AgentKey } from '@yaswami/core';
import { AGENTS } from '@yaswami/core';
import { Loading, Page } from '@/components/Page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item';
import { useOverview } from '@/hooks/useOverview';

export function AgentsScreen({ onShow }: { onShow: (agent: AgentKey) => void }) {
  const overview = useOverview();
  return (
    <Page
      title="Агенты"
      description="Кто что делает и кому пишет. Агенты не отправляют сообщений первыми без вас: исключение — поддержка, она отвечает тем, кто сам написал боту."
    >
      {!overview && <Loading rows={3} />}
      <div className="grid gap-3 md:grid-cols-2">
        {overview?.agents.map((a) => (
          <Card key={a.key}>
            <CardHeader>
              <CardTitle>{AGENTS[a.key].name}</CardTitle>
              <CardDescription>Когда отправляет: {AGENTS[a.key].sends}</CardDescription>
              <CardAction>
                <Badge variant={a.enabled ? 'default' : 'outline'}>{a.enabled ? 'включён' : 'выключен'}</Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p>{AGENTS[a.key].about}</p>
              <ItemGroup className="grid grid-cols-2 gap-2">
                {([[a.conversations, 'диалогов'], [a.drafts, 'черновиков ждут'], [a.sent_today, 'отправлено за сутки'], [a.sent, 'всего отправлено']] as const).map(([n, label]) => (
                  <Item key={label} size="xs" variant="muted">
                    <ItemContent><ItemTitle>{n}</ItemTitle><ItemDescription>{label}</ItemDescription></ItemContent>
                  </Item>
                ))}
              </ItemGroup>
            </CardContent>
            <CardFooter>
              <Button variant="outline" size="sm" onClick={() => onShow(a.key)}>Показать его диалоги</Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </Page>
  );
}
