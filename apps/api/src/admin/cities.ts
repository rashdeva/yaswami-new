// Города (City): к ним относятся источники, собранные события, организаторы и события Ясвами. Новый город добавляет
// команда; после этого ему можно завести источники — сборщик читает их в часовом поясе города.
import { eq } from 'drizzle-orm';
import type { City, CityCreateInput, CityUpdateInput } from '@yaswami/core';
import { DEFAULT_CITY_ID } from '@yaswami/core';
import type { Ctx } from '../audit.ts';
import { audited } from '../audit.ts';
import type { Db } from '../db/client.ts';
import { cities } from '../db/schema.ts';
import { AppError } from '../services.ts';

// Команде — все города, и в архиве тоже; гость (GET /cities) видит только работающие.
export { listAllCities as listCities } from '../services.ts';

export const createCity = (db: Db, ctx: Ctx, input: CityCreateInput): Promise<City> =>
  audited(db, ctx, { action: 'admin_cities_create', entity: 'city', id: (c) => c.id, input }, async (tx) => {
    const [city] = await tx.insert(cities).values(input).onConflictDoNothing().returning();
    if (!city) throw new AppError('city_exists', 409);
    return city;
  });

/**
 * Название, часовой пояс, витрина, статус. Пояс действует на события, собранные после правки: у собранных время уже
 * записано. `launch_status: archived` ставит город на паузу: ничего не удаляется, `launched` возвращает всё как было.
 */
export const updateCity = (db: Db, ctx: Ctx, id: string, input: CityUpdateInput): Promise<City> =>
  audited(db, ctx, { action: 'admin_cities_update', entity: 'city', id, input }, async (tx) => {
    // На городе по умолчанию держится всё, у чего город не указан: витрина, поддержка, сборщик.
    if (id === DEFAULT_CITY_ID && input.launch_status === 'archived') throw new AppError('default_city', 409);
    const [city] = Object.keys(input).length
      ? await tx.update(cities).set(input).where(eq(cities.id, id)).returning()
      : await tx.select().from(cities).where(eq(cities.id, id));
    if (!city) throw new AppError('not_found', 404);
    return city;
  });
