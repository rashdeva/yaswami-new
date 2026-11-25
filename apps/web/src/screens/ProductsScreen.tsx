import { useEffect } from 'react';
import type { ProductItem, Wire } from '@yaswami/core';
import { ProfileButton } from '../components/Avatar.tsx';
import { CityPick } from '../components/CityPick.tsx';
import { ProductCard } from '../components/ProductCard.tsx';
import { useProducts } from '../hooks/useProducts.ts';
import { useViewed } from '../hooks/useViewed.ts';
import { productCategoryName, productChips, productPlaceholder } from '../product.ts';

interface Props {
  city: string;
  onOpen: (product: Wire<ProductItem>) => void;
}

/** Вкладка «Товары»: что местные мастера делают сами, свежие сверху; плашки — категории, где в городе что-то есть. Открыта без входа. */
export function ProductsScreen({ city, onOpen }: Props) {
  const { products, categories, category, setCategory, failed, more, loadingMore } = useProducts();
  const chips = productChips(categories);
  useViewed('products_viewed');
  useEffect(() => { document.title = `Товары мастеров в городе ${city} — Я с вами`; }, [city]);

  return (
    <>
      <div className="top">
        <ProfileButton />
        <div className="head">
          <h1>Товары</h1>
          <CityPick />
        </div>
      </div>
      {chips.length > 0 && (
        <div className="chips">
          <button className="chip" aria-pressed={!category} onClick={() => setCategory(null)}>Все</button>
          {chips.map((c) => (
            <button key={c} className="chip" aria-pressed={category === c} onClick={() => setCategory(category === c ? null : c)}>{productPlaceholder(c)} {productCategoryName(c)}</button>
          ))}
        </div>
      )}
      {failed && <div className="state"><b>🌧</b><p>{failed.message}</p></div>}
      {!products && !failed && <div className="state"><div className="spinner" role="status" aria-label="Загрузка" /></div>}
      {products?.length === 0 && <div className="state"><b>🌿</b><p>Товаров пока нет. Загляните позже.</p></div>}
      {!!products?.length && (
        <>
          <div className="products">
            {products.map((p) => <ProductCard key={p.id} product={p} onOpen={() => onOpen(p)} />)}
          </div>
          {more && <div className="chips more"><button className="chip" disabled={loadingMore} onClick={more}>{loadingMore ? 'Загружаем…' : 'Показать ещё'}</button></div>}
          <p className="note">Товары собраны из открытых каналов мастеров и групп объявлений. Наличие и цену уточняйте у мастера.</p>
        </>
      )}
    </>
  );
}
