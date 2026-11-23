// «Каталог → Вакансии»: вакансии работодателей, собранные из чатов о работе. Новая ждёт решения; одобренную гости видят
// JOB_TTL_DAYS дней от последнего объявления; отклонённая остаётся в базе. Вкладка статуса — в адресе.
import { zodResolver } from '@hookform/resolvers/zod';
import type { Job, JobStatus, JobUpdateInput as Input, Wire } from '@yaswami/core';
import { JOB_STATUSES, JOB_TTL_DAYS, JobUpdateInput } from '@yaswami/core';
import { ChevronDownIcon } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { CityBadge } from '@/components/City';
import { ExternalLink, TelegramLink } from '@/components/EntityLink';
import { AreaField, SelectField, showIssues, TextField } from '@/components/Fields';
import { when } from '@/components/History';
import { Failed, Hint, Loading, LoadMore, Nothing, Page } from '@/components/Page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { FieldGroup } from '@/components/ui/field';
import { Item, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useJobs, useJobUpdate } from '@/hooks/useJobs';
import { JOB_LABELS, jobExpired } from '@/lib/catalog';
import { pickDirty } from '@/lib/form';
import type { CatalogKind } from '@/screens/CatalogServicesScreen';
import { KindToggle } from '@/screens/CatalogServicesScreen';

export type JobsFilter = 'all' | JobStatus;

const HINTS: Record<JobsFilter, string> = {
  all: 'Все вакансии, свежие сверху.',
  pending: 'Сборщик нашёл вакансию в чате о работе. В приложении её нет, пока вы её не одобрите.',
  published: `Видны гостям ${JOB_TTL_DAYS} дней от последнего объявления. Вакансию можно снять.`,
  rejected: 'Не выводятся нигде. Остаются в базе, чтобы повтор объявления не создал вакансию заново.',
};
const TABS: [JobsFilter, string][] = [...JOB_STATUSES.map((s) => [s, JOB_LABELS[s]] as [JobsFilter, string]), ['all', 'Все']];
const STATUS_OPTIONS = JOB_STATUSES.map((s) => [s, JOB_LABELS[s]] as const);

type Update = ReturnType<typeof useJobUpdate>;

/** Правка полей вакансии и её статуса (так же возвращают на рассмотрение): уходят только изменённые поля. */
function JobDialog({ job, update }: { job: Wire<Job>; update: Update }) {
  const [open, setOpen] = useState(false);
  const form = useForm({
    resolver: zodResolver(JobUpdateInput),
    values: { title: job.title, employer: job.employer, pay: job.pay, description: job.description, telegram_username: job.telegram_username, status: job.status },
  });
  const submit = form.handleSubmit((values) => {
    const input = pickDirty(values, form.formState.dirtyFields) as Input;
    if (!Object.keys(input).length) return setOpen(false);
    update({ id: job.id, input }, { onSuccess: () => setOpen(false), onError: (e) => showIssues(form, e) });
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="xs" variant="ghost">Изменить</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Вакансия «{job.title}»</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <ScrollArea className="h-32 rounded-md border">
            <Hint><span className="block p-2.5 whitespace-pre-wrap">{job.announcement.text}</span></Hint>
          </ScrollArea>
          <FieldGroup>
            <TextField form={form} name="title" label="Название" />
            <TextField form={form} name="employer" label="Кто нанимает" nullable />
            <TextField form={form} name="pay" label="Оплата" nullable />
            <TextField form={form} name="telegram_username" label="Контакт в Telegram" placeholder="username" />
            <SelectField form={form} name="status" label="Статус" options={STATUS_OPTIONS} />
            <AreaField form={form} name="description" label="Описание" nullable rows={5} />
          </FieldGroup>
          <DialogFooter><Button type="submit">Сохранить</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface Props {
  status: JobsFilter;
  onStatus: (status: JobsFilter) => void;
  onKind: (kind: CatalogKind) => void;
}

export function CatalogJobsScreen({ status, onStatus, onKind }: Props) {
  const { entries, error, hasNextPage, isFetchingNextPage, fetchNextPage } = useJobs({ status: status === 'all' ? undefined : status });
  const update = useJobUpdate();

  return (
    <Page title="Каталог" description={HINTS[status]}>
      <KindToggle kind="jobs" onKind={onKind} />
      <Tabs value={status} onValueChange={(v) => onStatus(v as JobsFilter)}>
        <TabsList className="h-auto flex-wrap">
          {TABS.map(([key, label]) => <TabsTrigger key={key} value={key}>{label}</TabsTrigger>)}
        </TabsList>
      </Tabs>
      {!entries && !error && <Loading />}
      {error && <Failed error={error} />}
      {entries?.length === 0 && <Nothing title={status === 'pending' ? 'Новых вакансий нет' : 'Ничего не нашлось'} />}
      {!!entries?.length && (
        <Table>
          <TableHeader>
            <TableRow><TableHead>Вакансия</TableHead><TableHead>Контакт</TableHead><TableHead>Объявление</TableHead><TableHead>Статус</TableHead><TableHead /></TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((j) => (
              <TableRow key={j.id}>
                <TableCell className="max-w-sm whitespace-normal align-top">
                  <Item size="xs" className="p-0">
                    <ItemContent>
                      <ItemTitle>{j.title}</ItemTitle>
                      <ItemDescription>{[j.employer ?? 'наниматель не назвался', j.pay ?? 'оплата не указана'].join(' · ')}</ItemDescription>
                      {j.description && <Hint>{j.description}</Hint>}
                    </ItemContent>
                  </Item>
                  <Collapsible>
                    <CollapsibleTrigger asChild><Button size="xs" variant="ghost">Текст объявления<ChevronDownIcon /></Button></CollapsibleTrigger>
                    <CollapsibleContent><Hint><span className="whitespace-pre-wrap">{j.announcement.text}</span></Hint></CollapsibleContent>
                  </Collapsible>
                </TableCell>
                <TableCell className="align-top"><TelegramLink username={j.telegram_username} /></TableCell>
                <TableCell className="align-top">
                  <div className="flex flex-col items-start gap-1">
                    <ExternalLink href={j.announcement.url} icon>{when(j.posted_at)}</ExternalLink>
                    <CityBadge id={j.city_id} />
                    {jobExpired(j.posted_at) && <Badge variant="outline">старше {JOB_TTL_DAYS} дней — гостям не показывается</Badge>}
                  </div>
                </TableCell>
                <TableCell className="align-top"><Badge variant={j.status === 'pending' ? 'default' : j.status === 'rejected' ? 'outline' : 'secondary'}>{JOB_LABELS[j.status]}</Badge></TableCell>
                <TableCell className="align-top">
                  <ButtonGroup className="justify-end">
                    <JobDialog job={j} update={update} />
                    {j.status !== 'published' && <Button size="xs" onClick={() => update({ id: j.id, input: { status: 'published' } })}>Одобрить</Button>}
                    {j.status !== 'rejected' && (
                      <Button size="xs" variant="outline" onClick={() => update({ id: j.id, input: { status: 'rejected' } })}>{j.status === 'pending' ? 'Отклонить' : 'Снять'}</Button>
                    )}
                  </ButtonGroup>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <LoadMore more={!!hasNextPage} loading={isFetchingNextPage} onMore={() => void fetchNextPage()} />
    </Page>
  );
}
