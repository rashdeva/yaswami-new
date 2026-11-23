import type { City, CollectedEventItem, Wire } from '@yaswami/core';

// Данные, с которыми сервер отдал страницу (apps/api/src/pages.ts, main.ts): первый показ обходится без запроса.
// `feed` — всегда лента первого города; `cities` — города, чтобы название города было сразу.
export const served = (() => {
  try {
    return JSON.parse(document.getElementById('initial')?.textContent ?? '{}') as { feed?: CollectedEventItem[]; event?: CollectedEventItem; cities?: Wire<City>[] };
  } catch {
    return {};
  }
})();
