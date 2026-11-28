import type { City, CollectedEventItem, Wire } from '@yaswami/core';
import { DEFAULT_CITY_ID } from '@yaswami/core';

// Данные, с которыми сервер отдал страницу (apps/api/src/pages.ts, main.ts): первый показ обходится без запроса.
// `feed` — всегда лента города по умолчанию; `cities` — города, чтобы название города было сразу; `default_city_id` —
// город по умолчанию этой копии (у копии для другой страны свой).
export const served = (() => {
  try {
    return JSON.parse(document.getElementById('initial')?.textContent ?? '{}') as {
      feed?: CollectedEventItem[]; event?: CollectedEventItem; cities?: Wire<City>[]; default_city_id?: string;
    };
  } catch {
    return {};
  }
})();

/** Город, который видит тот, кто город ещё не выбрал. В разработке страницу отдаёт Vite без данных — запасной из core. */
export const defaultCityId = served.default_city_id ?? DEFAULT_CITY_ID;
