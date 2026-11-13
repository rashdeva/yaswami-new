// Города (City): к ним относятся источники, собранные события, организаторы и события Ясвами. Новый город добавляет
// команда; после этого ему можно завести источники — сборщик читает их в часовом поясе города.
import { asc, eq } from 'drizzle-orm';
import type { City, CityCreateInput, CityUpdateInput } from '@yaswami/core';
import type { Ctx } from '../audit.ts';
import { audited } from '../audit.ts';
import type { Db } from '../db/client.ts';
import { cities } from '../db/schema.ts';
import { AppError } from '../services.ts';

export const listCities = (db: Db): Promise<City[]> => db.select().from(cities).orderBy(asc(cities.created_at));

export const createCity = (db: Db, ctx: Ctx, input: CityCreateInput): Promise<City> =>
  audited(db, ctx, { action: 'admin_cities_create', entity: 'city', id: (c) => c.id, input }, async (tx) => {
    const [city] = await tx.insert(cities).values(input).onConflictDoNothing().returning();
    if (!city) throw new AppError('city_exists', 409);
    return city;
  });

/** Название и часовой пояс. Пояс действует на события, собранные после правки: у собранных время уже записано. */
export const updateCity = (db: Db, ctx: Ctx, id: string, input: CityUpdateInput): Promise<City> =>
  audited(db, ctx, { action: 'admin_cities_update', entity: 'city', id, input }, async (tx) => {
    const [city] = Object.keys(input).length
      ? await tx.update(cities).set(input).where(eq(cities.id, id)).returning()
      : await tx.select().from(cities).where(eq(cities.id, id));
    if (!city) throw new AppError('not_found', 404);
    return city;
  });
