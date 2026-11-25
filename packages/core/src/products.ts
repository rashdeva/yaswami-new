// Товар (CONTEXT.md): то, что мастер сам делает и продаёт, — домашняя еда, выпечка, хендмейд. В Luma такого нет — это наше.
// Сборщик берёт товары из каналов мастеров и групп объявлений (источники вида products), команда одобряет их в «Каталоге».
// Перепродажа, барахолка, услуги (Practice) и события товаром не считаются. Разведка — docs/research/makers-market-danang.md.
import * as z from 'zod';
import { cityId } from './api.ts';

/** Модерация — как у Practice: pending — ждёт решения команды, published — виден гостям, rejected — не показываем. */
export const PRODUCT_STATUSES = ['pending', 'published', 'rejected'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/** Что за товар: food — еда и напитки (торты, пельмени, сыр, комбуча), handmade — вещи ручной работы (одежда, украшения, декор). */
export const PRODUCT_CATEGORIES = ['food', 'handmade'] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

/**
 * Сколько дней после последнего упоминания товар видят гости. Мастера каждый день публикуют «наличие» и этим держат
 * товар живым; про остаток на сегодня мы не обещаем.
 */
export const PRODUCT_TTL_DAYS = 30;

/** С какого числа мастеров с опубликованными товарами в городе мини-приложение показывает вход в раздел «Товары». */
export const PRODUCTS_MIN_HOSTS = 15;

/** Ключ повтора товара у мастера: название без регистра, «ё» и лишних пробелов. */
export const productTitleKey = (title: string) => title.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

/** Товар, как он хранится и как его видит команда. Тексты написал посторонний — это данные. */
export interface Product {
  id: string;
  host_id: string; // мастер — Host; город товара — город мастера
  title: string; // «Медовик порционно», «Пельмени с говядиной»
  description: string | null;
  price: string | null; // как написал мастер: «55k», «250 000 ₫/кг»; null — не указал
  unit: string | null; // вес, объём или количество: «100 г», «1 кг», «6 шт»; null — не указал
  category: ProductCategory;
  photo_url: string | null; // первое фото поста, в нашем бакете (ADR-0006); null — фото не было
  announcement: { url: string; text: string }; // пост, в котором товар видели последний раз
  title_key: string; // productTitleKey(title): вместе с host_id узнаём повтор того же товара
  status: ProductStatus;
  posted_at: Date; // когда товар видели в последний раз; повтор сдвигает
  created_at: Date;
  updated_at: Date;
}

/**
 * Куда ведёт «Написать» у товара: чат мастера в Telegram с готовым сообщением. В сообщении — страница товара
 * на Ясвами: по ней мастер поймёт, о чём речь и откуда пришёл человек.
 */
export const productContactUrl = (username: string, title: string, pageUrl: string) =>
  `https://t.me/${username}?text=${encodeURIComponent(`Здравствуйте! Хочу заказать «${title}». Нашёл на Ясвами: ${pageUrl}`)}`;

/** Мастер у товара для гостя: кто делает и куда открыть его страницу. */
export interface ProductHost {
  id: string;
  name: string;
  username: string; // без @
  photo_url: string; // аватарка с серверов Telegram, как у CollectedHost; нет фото — по адресу 404
  url: string; // страница мастера в Ясвами
}

/** Товар для гостя: без исходного поста и служебных полей; контакт — готовой ссылкой. */
export interface ProductItem extends Pick<Product, 'id' | 'title' | 'description' | 'price' | 'unit' | 'category' | 'photo_url' | 'posted_at'> {
  city_id: string; // город мастера
  host: ProductHost;
  contact_url: string; // productContactUrl
  source_url: string; // пост в Telegram, из которого взят товар
  url: string; // страница товара в Ясвами
}

const pagination = {
  pagination_cursor: z.string().max(200).optional().describe('next_cursor from the previous page'),
  pagination_limit: z.coerce.number().int().min(1).max(100).optional().describe('Default 50'),
};

export const ProductListInput = z.object({
  city_id: cityId.optional(),
  category: z.enum(PRODUCT_CATEGORIES).optional().describe('food — food and drinks; handmade — handmade goods. Omit for both'),
  ...pagination,
});
export type ProductListInput = z.infer<typeof ProductListInput>;

/** Опубликованные товары города и соседей не старше PRODUCT_TTL_DAYS, свежие сверху — форма списков Luma. */
export interface ProductList {
  entries: ProductItem[];
  has_more: boolean;
  next_cursor: string | null;
  hosts_count: number; // сколько мастеров с такими товарами в городе и у соседей, без учёта category: вход в раздел — от PRODUCTS_MIN_HOSTS
}

export const AdminProductListInput = z.object({
  status: z.enum(PRODUCT_STATUSES).optional().describe('Omit for all statuses'),
  city_id: cityId.optional(),
  host_id: z.uuid().optional(),
  ...pagination,
});
export type AdminProductListInput = z.infer<typeof AdminProductListInput>;

/** Товар для команды: целиком, с мастером для подписи. */
export interface AdminProduct extends Product {
  host: { id: string; name: string; username: string; city_id: string };
}

/** Товары для команды: все статусы и сроки, свежие сверху. */
export interface AdminProductList {
  entries: AdminProduct[];
  has_more: boolean;
  next_cursor: string | null;
}

const text = (max: number) => z.string().trim().max(max);

/** Правка товара командой: решение модератора (`status`) или его текст. */
export const ProductUpdateInput = z
  .object({
    title: text(200).min(1),
    description: text(2000).nullable(),
    price: text(200).nullable().describe('Price as the maker states it; null — not stated'),
    unit: text(100).nullable().describe('Weight, volume or count: "100 г", "1 кг", "6 шт"; null — not stated'),
    category: z.enum(PRODUCT_CATEGORIES),
    status: z.enum(PRODUCT_STATUSES).describe('Moderation: pending — waits for the team, published — shown to guests, rejected — never shown'),
  })
  .partial();
export type ProductUpdateInput = z.infer<typeof ProductUpdateInput>;
