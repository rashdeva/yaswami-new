import { useCity } from '../hooks/useSession.ts';

/**
 * Город в заголовке экрана: «📍 Дананг», нажатие открывает список городов. Показываем и тому, кто город ещё не
 * выбирал: он видит город по умолчанию и должен иметь возможность его сменить.
 */
export function CityPick() {
  const city = useCity();
  if (city.chosen === undefined || !city.cities.length) return null;
  return (
    <label className="city-pick">
      📍{' '}
      <select aria-label="Город" value={city.city_id} onChange={(e) => city.set(e.target.value)}>
        {city.cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </label>
  );
}
