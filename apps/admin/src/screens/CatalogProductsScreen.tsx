// «Каталог → Товары»: то, что мастера сами делают и продают, — собрано из их каналов и групп объявлений. Новый товар
// ждёт решения; одобренный гости видят PRODUCT_TTL_DAYS дней от последнего упоминания; отклонённый остаётся в базе,
// чтобы повтор поста не создал его заново. Вкладка статуса и поиск — в адресе.
import { zodResolver } from '@hookform/resolvers/zod';
import type { AdminProduct, ProductStatus, ProductUpdateInput as Input, Wire } from '@yaswami/core';
import { PRODUCT_CATEGORIES, PRODUCT_STATUSES, PRODUCT_TTL_DAYS, ProductUpdateInput } from '@yaswami/core';
import { ChevronDownIcon } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { CityBadge } from '@/components/City';
import { EntityLink, ExternalLink, TelegramLink } from '@/components/EntityLink';
import { AreaField, SelectField, showIssues, TextField } from '@/components/Fields';
import { when } from '@/components/History';
import { Failed, Hint, Loading, LoadMore, Nothing, Page } from '@/components/Page';
import { ActionsCell, ActionsHead } from '@/components/RowActions';
import { Search } from '@/components/Search';
import { AspectRatio } from '@/components/ui/aspect-ratio';
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
import { titleTaken, useProductCounts, useProducts, useProductUpdate } from '@/hooks/useProducts';
import { matchProduct, PRODUCT_CATEGORY_LABELS, PRODUCT_LABELS, productExpired, productPrice } from '@/lib/catalog';
import { pickDirty } from '@/lib/form';
import type { CatalogKind } from '@/screens/CatalogServicesScreen';
import { KindToggle } from '@/screens/CatalogServicesScreen';

export type ProductsFilter = 'all' | ProductStatus;

const HINTS: Record<ProductsFilter, string> = {
  all: 'Все товары мастеров, свежие сверху.',
  pending: 'Сборщик нашёл товар в канале мастера или группе объявлений. Гости его не видят, пока вы его не одобрите.',
  published: `Видны гостям ${PRODUCT_TTL_DAYS} дней от последнего упоминания: мастер держит товар живым, публикуя «наличие». Товар можно снять.`,
  rejected: 'Не выводятся нигде. Остаются в базе, чтобы повтор поста не создал товар заново.',
};
const TABS: [ProductsFilter, string][] = [...PRODUCT_STATUSES.map((s) => [s, PRODUCT_LABELS[s]] as [ProductsFilter, string]), ['all', 'Все']];
const STATUS_OPTIONS = PRODUCT_STATUSES.map((s) => [s, PRODUCT_LABELS[s]] as const);
const CATEGORY_OPTIONS = PRODUCT_CATEGORIES.map((c) => [c, PRODUCT_CATEGORY_LABELS[c]] as const);

type Update = ReturnType<typeof useProductUpdate>;

/** Правка полей товара и его статуса (так же возвращают на рассмотрение): уходят только изменённые поля. */
function ProductDialog({ product, update }: { product: Wire<AdminProduct>; update: Update }) {
  const [open, setOpen] = useState(false);
  const form = useForm({
    resolver: zodResolver(ProductUpdateInput),
    values: { title: product.title, description: product.description, price: product.price, unit: product.unit, category: product.category, status: product.status },
  });
  const submit = form.handleSubmit((values) => {
    const input = pickDirty(values, form.formState.dirtyFields) as Input;
    if (!Object.keys(input).length) return setOpen(false);
    update({ id: product.id, input }, {
      onSuccess: () => setOpen(false),
      onError: (e) => (titleTaken(e) ? form.setError('title', { message: e.message }) : showIssues(form, e)),
    });
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="xs" variant="ghost">Изменить</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Товар «{product.title}»</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <ScrollArea className="h-32 rounded-md border">
            <Hint><span className="block p-2.5 whitespace-pre-wrap">{product.announcement.text}</span></Hint>
          </ScrollArea>
          <FieldGroup>
            <TextField form={form} name="title" label="Название" />
            <TextField form={form} name="price" label="Цена" nullable placeholder="как у мастера: 55k, 250 000 ₫/кг" />
            <TextField form={form} name="unit" label="Вес, объём или количество" nullable placeholder="100 г, 1 кг, 6 шт" />
            <SelectField form={form} name="category" label="Категория" options={CATEGORY_OPTIONS} />
            <SelectField form={form} name="status" label="Статус" options={STATUS_OPTIONS} />
            <AreaField form={form} name="description" label="Описание" nullable rows={4} />
          </FieldGroup>
          <DialogFooter><Button type="submit">Сохранить</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Фото товара квадратом; фото в посте не было — пустая плашка. */
const Photo = ({ url }: { url: string | null }) => (
  <div className="w-14">
    <AspectRatio ratio={1} className="overflow-hidden rounded-md bg-muted">
      {url && <img className="size-full object-cover" src={url} alt="" loading="lazy" />}
    </AspectRatio>
  </div>
);

interface Props {
  status: ProductsFilter;
  query: string;
  onFilter: (filter: { status: ProductsFilter; query: string }) => void;
  onKind: (kind: CatalogKind) => void;
}

export function CatalogProductsScreen({ status, query, onFilter, onKind }: Props) {
  const { entries, error, more } = useProducts({ status: status === 'all' ? undefined : status });
  const counts = useProductCounts();
  const update = useProductUpdate();
  const list = entries?.filter((p) => matchProduct(p, query));

  return (
    <Page title="Каталог" description={HINTS[status]}>
      <KindToggle kind="products" onKind={onKind} />
      <Tabs value={status} onValueChange={(v) => onFilter({ status: v as ProductsFilter, query })}>
        <TabsList className="h-auto flex-wrap">
          {TABS.map(([key, label]) => <TabsTrigger key={key} value={key}>{label} {counts && <Badge variant="secondary">{counts[key]}</Badge>}</TabsTrigger>)}
        </TabsList>
      </Tabs>
      <Search value={query} onChange={(e) => onFilter({ status, query: e.target.value })} placeholder="Товар, имя мастера или @username" />
      {!entries && !error && <Loading />}
      {error && <Failed error={error} />}
      {list?.length === 0 && <Nothing title={status === 'pending' && !query ? 'Новых товаров нет' : 'Ничего не нашлось'} />}
      {!!list?.length && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Фото</TableHead><TableHead>Товар</TableHead><TableHead>Цена</TableHead><TableHead>Мастер</TableHead>
              <TableHead>Категория</TableHead><TableHead>Пост</TableHead><TableHead>Статус</TableHead><ActionsHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="align-top"><Photo url={p.photo_url} /></TableCell>
                <TableCell className="max-w-sm whitespace-normal align-top">
                  <Item size="xs" className="p-0">
                    <ItemContent>
                      <ItemTitle>{p.title}</ItemTitle>
                      {p.description && <ItemDescription>{p.description}</ItemDescription>}
                    </ItemContent>
                  </Item>
                  <Collapsible>
                    <CollapsibleTrigger asChild><Button size="xs" variant="ghost">Текст поста<ChevronDownIcon /></Button></CollapsibleTrigger>
                    <CollapsibleContent><Hint><span className="whitespace-pre-wrap">{p.announcement.text}</span></Hint></CollapsibleContent>
                  </Collapsible>
                </TableCell>
                <TableCell className="align-top">{productPrice(p)}</TableCell>
                <TableCell className="align-top">
                  <Item size="xs" className="p-0">
                    <ItemContent>
                      <ItemTitle><EntityLink entity="host" id={p.host.id}>{p.host.name}</EntityLink></ItemTitle>
                      <ItemDescription><TelegramLink username={p.host.username} /></ItemDescription>
                    </ItemContent>
                  </Item>
                </TableCell>
                <TableCell className="align-top">{PRODUCT_CATEGORY_LABELS[p.category]}</TableCell>
                <TableCell className="align-top">
                  <div className="flex flex-col items-start gap-1">
                    <ExternalLink href={p.announcement.url} icon>{when(p.posted_at)}</ExternalLink>
                    <CityBadge id={p.host.city_id} />
                    {productExpired(p.posted_at) && <Badge variant="outline">старше {PRODUCT_TTL_DAYS} дней — гостям не показывается</Badge>}
                  </div>
                </TableCell>
                <TableCell className="align-top"><Badge variant={p.status === 'pending' ? 'default' : p.status === 'rejected' ? 'outline' : 'secondary'}>{PRODUCT_LABELS[p.status]}</Badge></TableCell>
                <ActionsCell className="align-top">
                  <ButtonGroup>
                    <ProductDialog product={p} update={update} />
                    {p.status !== 'published' && <Button size="xs" onClick={() => update({ id: p.id, input: { status: 'published' } })}>Одобрить</Button>}
                    {p.status !== 'rejected' && (
                      <Button size="xs" variant="outline" onClick={() => update({ id: p.id, input: { status: 'rejected' } })}>{p.status === 'pending' ? 'Отклонить' : 'Снять'}</Button>
                    )}
                  </ButtonGroup>
                </ActionsCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <LoadMore {...more} />
    </Page>
  );
}
