// «📍 Город» в шапке витрины и «Услуг»: городов больше одного — это выбор (обычный <select>: в Telegram он открывает
// системный список), один — просто название.
import { useCity } from '../hooks/useSession.ts';

export function CityPicker({ suffix }: { suffix?: string }) {
  const { city_id, name, cities, set } = useCity();
  if (cities.length < 2) return <p>📍 {name}{suffix}</p>;
  return (
    <p>
      📍 <select className="city" aria-label="Город" value={city_id} onChange={(e) => set(e.target.value)}>
        {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>{suffix}
    </p>
  );
}
