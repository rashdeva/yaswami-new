import type { ProductItem } from '@yaswami/core';
import { productPlaceholder, productPrice } from '../product.ts';

export type ProductCardData = Pick<ProductItem, 'id' | 'title' | 'price' | 'unit' | 'category' | 'photo_url'> & { host: Pick<ProductItem['host'], 'name'> };

/**
 * Карточка товара (Product): фото, название, цена с весом и мастер. `row` — строкой, как событие в ленте (поиск);
 * иначе плиткой для сетки в две колонки. Фото нет или не загрузилось — заглушка категории.
 */
export function ProductCard({ product: p, row, onOpen }: { product: ProductCardData; row?: boolean; onOpen: () => void }) {
  return (
    <a
      className={row ? 'ev product-row' : 'product'}
      href={`/products/${p.id}`}
      onClick={(click) => {
        if (click.metaKey || click.ctrlKey || click.shiftKey) return; // Cmd/Ctrl-клик — новая вкладка
        click.preventDefault();
        onOpen();
      }}
    >
      <div className={row ? 'th ph' : 'ph'} aria-hidden="true">
        {productPlaceholder(p.category)}
        {p.photo_url && <img src={p.photo_url} alt="" loading="lazy" onError={(e) => { e.currentTarget.hidden = true; }} />}
      </div>
      <div>
        <b>{p.title}</b>
        <span className="price">{productPrice(p)}</span>
        <small>{p.host.name}</small>
      </div>
    </a>
  );
}
