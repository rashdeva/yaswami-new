// Город сущности: выбор в форме, выбор вне формы (строка таблицы, добавление) и название в списке.
import type { Form } from '@/components/Fields';
import { SelectField } from '@/components/Fields';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCities } from '@/hooks/useCities';

/** Поле `city_id` формы. */
export function CityField({ form, hint }: { form: Form; hint?: string }) {
  const { data } = useCities().cities;
  return <SelectField form={form} name="city_id" label="Город" hint={hint} options={(data ?? []).map((c) => [c.id, c.name] as const)} />;
}

export function CitySelect({ value, onChange }: { value: string; onChange: (city_id: string) => void }) {
  const { data } = useCities().cities;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" aria-label="Город"><SelectValue /></SelectTrigger>
      <SelectContent>{(data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
    </Select>
  );
}

/** Название города по id; пока список не загружен — сам id. */
export function CityBadge({ id }: { id: string }) {
  const { data } = useCities().cities;
  return <Badge variant="outline">{data?.find((c) => c.id === id)?.name ?? id}</Badge>;
}
