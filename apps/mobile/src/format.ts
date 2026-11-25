import type { ProductCategory } from '@yaswami/core';
import { productCategoryBySlug } from '@yaswami/core';
import { collectedDay, collectedDayKey, topicIcon } from '@yaswami/core';
import { SITE } from './api';

/** YYYY-MM-DD устройства со сдвигом в днях. */
function localDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** «Сегодня», «Завтра» или «пятница, 14 ноября» — как в мини-приложении. */
export function dayLabel(wall: string): string {
  const key = collectedDayKey(wall);
  return key === localDate() ? 'Сегодня' : key === localDate(1) ? 'Завтра' : collectedDay(wall);
}

/** Иконка темы лежит на сайте рядом с мини-приложением. */
export const topicIconUrl = (topic?: string | null) => SITE + topicIcon(topic);

/** «пт, 20 ноября, 19:00» во времени самого события. */
export function when(startAt: string, timeZone: string): string {
  const date = new Date(startAt);
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('ru', { timeZone, ...o }).format(date);
  return `${part({ weekday: 'short', day: 'numeric', month: 'long' })}, ${part({ hour: '2-digit', minute: '2-digit' })}`;
}

/** Цена товара с весом или количеством: «55k · 100 г»; цены нет — «цена по запросу». Как в мини-приложении. */
export const productPrice = (p: { price: string | null; unit: string | null }) => [p.price ?? 'цена по запросу', p.unit].filter(Boolean).join(' · ');

/** Заглушка вместо фото товара — знак категории (PRODUCT_CATEGORIES). Как в мини-приложении. */
export const productPlaceholder = (category: ProductCategory) => productCategoryBySlug(category)?.emoji ?? '🛍️';

/** Подпись категории товара — название из core. */
export const productCategoryName = (category: ProductCategory) => productCategoryBySlug(category)?.name ?? category;
