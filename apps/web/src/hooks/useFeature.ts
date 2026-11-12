import type { Feature } from '@yaswami/core';
import { useSession } from './useSession.ts';

/** Открыта ли человеку возможность (создавать события и т. п.). Решает сервер (`/me`); здесь по ней только прячем лишнее. */
export function useFeature(feature: Feature): boolean {
  return useSession().features.includes(feature);
}
