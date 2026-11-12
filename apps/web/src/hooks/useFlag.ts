import { useSyncExternalStore } from 'react';
import { flag, onFlags } from '../analytics.ts';

/**
 * Флаг PostHog: эксперимент или постепенная выкатка — текст, вид экрана, порядок блоков. `fallback` — что показываем,
 * пока PostHog не ответил, если его срезал блокировщик и в разработке; с ним приложение обязано работать.
 * Права и лимиты сюда не идут: для них — возможность (`useFeature`), её проверяет сервер.
 */
export function useFlag<T extends boolean | string>(name: string, fallback: T): T {
  return useSyncExternalStore(onFlags, () => flag(name, fallback));
}
