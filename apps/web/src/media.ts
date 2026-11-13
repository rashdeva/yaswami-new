import type { CollectedMedia } from '@yaswami/core';

/**
 * Как показать медиа публикации. Первый вертикальный ролик (около 9:16) — обложка шапки: горизонтальный в ней обрезался бы.
 * Остальное — лентой, но одно фото не показываем: обложка обычно и есть оно, а случайный кадр без пары выглядит странно.
 */
export function mediaLayout(media: CollectedMedia[] = []): { hero: CollectedMedia | null; gallery: CollectedMedia[] } {
  const hero = media.find((m) => m.type === 'video' && !!m.width && !!m.height && m.height >= m.width * 1.3) ?? null;
  const rest = media.filter((m) => m !== hero);
  return { hero, gallery: rest.length > 1 || rest.some((m) => m.type === 'video') ? rest : [] };
}
