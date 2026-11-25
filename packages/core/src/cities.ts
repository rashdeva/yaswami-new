// Соседние города: где города стоят тесно (юг Шри-Ланки: Велигама, Мирисса, Ахангама в 5–10 км друг от друга),
// витрина города показывает и события соседей. Сосед — город с координатами в пределах NEARBY_KM. В Luma такого нет.

/** Радиус «рядом»: соседи в нём попадают в витрину, каталог, поиск и сводку по темам. */
export const NEARBY_KM = 25;
/** Дальше этого геолокация город не выбирает: человек, видимо, не в наших краях. */
export const NEAREST_MAX_KM = 100;

interface Point { latitude: number | null; longitude: number | null }
interface Place extends Point { id: string }

/** Расстояние по поверхности Земли (гаверсинус), км. */
export function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.latitude - a.latitude) / 2) ** 2
    + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const located = (p: Point): p is { latitude: number; longitude: number } => p.latitude !== null && p.longitude !== null;

/** Город и его соседи, ближние первыми. Сам город — всегда (даже неизвестный); у города без координат соседей нет. */
export function nearbyCityIds(cities: readonly Place[], city_id: string, km = NEARBY_KM): string[] {
  const home = cities.find((c) => c.id === city_id);
  if (!home || !located(home)) return [city_id];
  return cities
    .flatMap((c) => (located(c) ? [{ id: c.id, d: distanceKm(home, c) }] : []))
    .filter((c) => c.id === city_id || c.d <= km)
    .sort((a, b) => a.d - b.d)
    .map((c) => c.id);
}

/** Ближайший к точке город не дальше NEAREST_MAX_KM; null — рядом наших городов нет. */
export function nearestCityId(cities: readonly Place[], at: { latitude: number; longitude: number }): string | null {
  let best: { id: string; d: number } | null = null;
  for (const c of cities) {
    if (!located(c)) continue;
    const d = distanceKm(at, c);
    if (d <= NEAREST_MAX_KM && (!best || d < best.d)) best = { id: c.id, d };
  }
  return best?.id ?? null;
}
