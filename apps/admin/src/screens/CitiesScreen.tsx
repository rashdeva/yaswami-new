// «Города»: к городу относятся источники, события каталога, организаторы и события Ясвами. Новый город — здесь,
// затем ему добавляют источники в «Источниках».
import { zodResolver } from '@hookform/resolvers/zod';
import type { City, CityCreateInput as CreateInput, CityUpdateInput as UpdateInput, Wire } from '@yaswami/core';
import { CityCreateInput, CityUpdateInput } from '@yaswami/core';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { SaveBar, saveDirty, showIssues, TextField } from '@/components/Fields';
import { Failed, Loading, Page, Section } from '@/components/Page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { useCities } from '@/hooks/useCities';

const DESCRIPTION = 'Города, в которых работает сервис. У источника, события каталога, организатора и события Ясвами указан город; всё, что было до городов, — Дананг. Витрина пока показывает только первый город: события остальных видны здесь, в админке. Чтобы начать собирать новый город — добавьте его и заведите ему источники в «Источниках».';
const ZONE_HINT = 'IANA, например Asia/Tbilisi. В нём сборщик читает время в анонсах города';
const EMPTY: CreateInput = { id: '', name: '', timezone: '' };

function CityForm({ city }: { city: Wire<City> }) {
  const { update } = useCities();
  const values = useMemo((): UpdateInput => ({ name: city.name, timezone: city.timezone }), [city]);
  const form = useForm({ resolver: zodResolver(CityUpdateInput), values, resetOptions: { keepDirtyValues: true } });
  return (
    <Section title={city.name} description={`id: ${city.id}`}>
      <form onSubmit={saveDirty(form, (input: UpdateInput, cb) => update({ id: city.id, ...input }, cb))} className="flex flex-col gap-4">
        <FieldGroup>
          <div className="grid gap-4 md:grid-cols-2">
            <TextField form={form} name="name" label="Название" />
            <TextField form={form} name="timezone" label="Часовой пояс" hint={ZONE_HINT} />
          </div>
        </FieldGroup>
        <SaveBar form={form} />
      </form>
    </Section>
  );
}

export function CitiesScreen() {
  const { cities: { data: cities, error }, create } = useCities();
  const form = useForm({ resolver: zodResolver(CityCreateInput), defaultValues: EMPTY });
  const submit = form.handleSubmit((input) => create(input, { onSuccess: () => form.reset(EMPTY), onError: (e) => showIssues(form, e) }));
  return (
    <Page title={<>Города <Badge>{cities?.length ?? '…'}</Badge></>} description={DESCRIPTION}>
      {!cities && !error && <Loading />}
      {error && <Failed error={error} />}
      {cities?.map((c) => <CityForm key={c.id} city={c} />)}
      <Section title="Новый город">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <FieldGroup>
            <div className="grid gap-4 md:grid-cols-3">
              <TextField form={form} name="id" label="id" hint="Латиницей, например tbilisi. Потом не меняется" />
              <TextField form={form} name="name" label="Название" placeholder="Тбилиси" />
              <TextField form={form} name="timezone" label="Часовой пояс" hint={ZONE_HINT} />
            </div>
          </FieldGroup>
          <div><Button type="submit">Добавить</Button></div>
        </form>
      </Section>
    </Page>
  );
}
