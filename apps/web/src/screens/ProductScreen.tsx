import { useEffect } from 'react';
import { GuestRow } from '../components/GuestRow.tsx';
import { contactProduct, useProduct } from '../hooks/useProducts.ts';
import { useViewed } from '../hooks/useViewed.ts';
import { PRODUCT_CATEGORY_LABELS, productPlaceholder, productPrice } from '../product.ts';
import { openExternal } from '../tg.ts';

interface Props {
  id: string;
  city: string;
  onOpenHost: (hostId: string) => void;
  onBack: (() => void) | null;
}

/** Страница товара: фото, что это, почём, кто делает и как написать мастеру. */
export function ProductScreen({ id, city, onOpenHost, onBack }: Props) {
  const { product: p, failed } = useProduct(id);
  useViewed('product_viewed', id);
  useEffect(() => { if (p) document.title = `${p.title} — ${p.host.name}, ${city}, Я с вами`; }, [p, city]);

  if (!p) {
    return failed ? (
      <div className="state">
        <b>🫥</b>
        <p>{failed.message}</p>
        {onBack && <button className="chip" onClick={onBack}>← Все товары</button>}
      </div>
    ) : (
      <div className="state"><div className="spinner" role="status" aria-label="Загрузка" /></div>
    );
  }

  return (
    <>
      <div className={`hero${onBack ? '' : ' nb'}`}>
        {onBack && <button className="back" onClick={onBack}>← Все товары</button>}
        <small>{[city, PRODUCT_CATEGORY_LABELS[p.category]].join(' · ')}</small>
        <h1>{p.title}</h1>
      </div>

      <div className="product-photo ph" data-empty={p.photo_url ? undefined : ''} aria-hidden="true">
        {productPlaceholder(p.category)}
        {p.photo_url && <img src={p.photo_url} alt="" onError={(e) => { e.currentTarget.hidden = true; }} />}
      </div>

      <div className="group">
        <div className="meta">
          <div><span>💰</span><span>{productPrice(p)}</span></div>
          <div><span>🔗</span><a href={p.source_url} onClick={(e) => { e.preventDefault(); openExternal(p.source_url); }}>Пост мастера в Telegram</a></div>
        </div>
      </div>
      {p.description && <div className="group"><div className="meta"><div className="text">{p.description}</div></div></div>}

      <h2>Мастер</h2>
      <div className="group">
        <button className="plain" onClick={() => onOpenHost(p.host.id)}>
          <GuestRow name={p.host.name} photo={p.host.photo_url} sub={`@${p.host.username}`} label="›" />
        </button>
      </div>
      <p className="note">Товар мы нашли в открытом канале или группе объявлений. Наличие на сегодня, цену и доставку уточняйте у мастера — заказ принимает он сам.</p>

      <div className="main"><div>
        <button className="cta" onClick={() => contactProduct(p)}>Написать</button>
      </div></div>
    </>
  );
}
