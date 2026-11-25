// Показ товара (Product): чистые функции без React и окружения сборки — их проверяет node --test.
import type { ProductCategory } from '@yaswami/core';
import { productCategoryBySlug } from '@yaswami/core';

/** Цена товара с весом или количеством: «55k · 100 г». Цены нет — «цена по запросу»: мастер скажет в чате. */
export const productPrice = (p: { price: string | null; unit: string | null }) => [p.price ?? 'цена по запросу', p.unit].filter(Boolean).join(' · ');

/** Заглушка вместо фото: товар сохраняется и без фото, тогда на плитке — знак категории (PRODUCT_CATEGORIES). */
export const productPlaceholder = (category: ProductCategory) => productCategoryBySlug(category)?.emoji ?? '🛍️';

/** Подпись категории для плашки и карточки. */
export const productCategoryName = (category: ProductCategory) => productCategoryBySlug(category)?.name ?? category;

/**
 * Плашки над списком: категории, где в городе есть товары (`categories` из products/list, уже в порядке PRODUCT_CATEGORIES).
 * Одна категория на весь город — плашки ничего не отбирают, их нет.
 */
export const productChips = (categories: readonly ProductCategory[]) => (categories.length > 1 ? categories : []);
