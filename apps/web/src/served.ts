import type { CollectedEventItem } from '@yaswami/core';

// Данные, с которыми сервер отдал страницу (apps/api/src/pages.ts): первый показ обходится без запроса.
export const served = (() => {
  try {
    return JSON.parse(document.getElementById('initial')?.textContent ?? '{}') as { feed?: CollectedEventItem[]; event?: CollectedEventItem };
  } catch {
    return {};
  }
})();
