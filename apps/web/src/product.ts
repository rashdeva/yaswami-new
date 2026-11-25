// Показ товара (Product): чистые функции без React и окружения сборки — их проверяет node --test.
import type { ProductCategory } from '@yaswami/core';

/** Цена товара с весом или количеством: «55k · 100 г». Цены нет — «цена по запросу»: мастер скажет в чате. */
export const productPrice = (p: { price: string | null; unit: string | null }) => [p.price ?? 'цена по запросу', p.unit].filter(Boolean).join(' · ');

/** Заглушка вместо фото: товар сохраняется и без фото, тогда на плитке — знак категории. */
export const productPlaceholder = (category: ProductCategory) => (category === 'food' ? '🥧' : '🧶');

/** Подпись категории для переключателя и карточки. */
export const PRODUCT_CATEGORY_LABELS: Record<ProductCategory, string> = { food: 'Еда', handmade: 'Хендмейд' };
