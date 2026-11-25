// Товар (CONTEXT.md): то, что мастер сам делает и продаёт, — домашняя еда, выпечка, хендмейд. В Luma такого нет — это наше.
// Сборщик берёт товары из каналов мастеров и групп объявлений (источники вида products), команда одобряет их в «Каталоге».
// Перепродажа, барахолка, услуги (Practice) и события товаром не считаются. Разведка — docs/research/makers-market-danang.md.
import * as z from 'zod';
import { cityId } from './api.ts';

/** Модерация — как у Practice: pending — ждёт решения команды, published — виден гостям, rejected — не показываем. */
export const PRODUCT_STATUSES = ['pending', 'published', 'rejected'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/**
 * Категория товара (CONTEXT.md, ADR-0013): по ней гость ищет, что ему нужно, — торт, творог, пельмени в морозилку, свечу.
 * Список меняет команда; `what` — что входит, по нему же ИИ ставит категорию при разборе поста. Порядок — порядок плашек.
 * Разведка, откуда такие группы: docs/research/product-categories-2026-11.md. В Luma такого нет — это наше.
 * Пометки о составе («без сахара», «без глютена», «веган») — не категория: они остаются в описании товара.
 */
export const PRODUCT_CATEGORIES = [
  { slug: 'bakery', name: 'Выпечка и десерты', emoji: '🎂', what: 'торты, порционные десерты, пирожные, печенье, конфеты, хлеб и выпечка на закваске, пироги' },
  { slug: 'frozen', name: 'Пельмени и полуфабрикаты', emoji: '🥟', what: 'пельмени, вареники, манты, блинчики с начинкой, котлеты, сырники, голубцы — замороженное, чтобы приготовить дома' },
  { slug: 'meals', name: 'Готовая еда', emoji: '🍲', what: 'обеды и ужины на сегодня, супы, вторые блюда, салаты, домашние суши, рационы и ланч-боксы с доставкой' },
  { slug: 'dairy', name: 'Молочное и сыр', emoji: '🧀', what: 'творог, сметана, кефир, йогурт, айран, сырки, домашний сыр, масло' },
  { slug: 'pantry', name: 'Заготовки и деликатесы', emoji: '🫙', what: 'варенье и джемы, соленья и квашеная капуста, маринады, икра из овощей, соусы и аджика, вяленое мясо и рыба, сало, колбаски, гранола' },
  { slug: 'drinks', name: 'Напитки', emoji: '🧃', what: 'комбуча, морс, компот, квас, лимонады, кофе своей обжарки, чай своего сбора' },
  { slug: 'farm', name: 'Фермерское', emoji: '🥬', what: 'овощи, фрукты, зелень, яйца, мёд, мясо и птица — что человек вырастил сам, не перекупил на рынке' },
  { slug: 'cosmetics', name: 'Косметика и мыло', emoji: '🧼', what: 'мыло, кремы, бальзамы, скрабы, натуральная косметика ручной работы' },
  { slug: 'wear', name: 'Одежда и украшения', emoji: '💍', what: 'одежда своего пошива, вязаное, украшения, сумки, аксессуары из кожи' },
  { slug: 'decor', name: 'Дом и подарки', emoji: '🕯️', what: 'свечи, керамика, декор, картины, текстиль, блокноты, игрушки ручной работы, подарочные наборы' },
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number]['slug'];
export const PRODUCT_CATEGORY_SLUGS = PRODUCT_CATEGORIES.map((c) => c.slug) as [ProductCategory, ...ProductCategory[]];
export const productCategoryBySlug = (slug: string | null | undefined) => PRODUCT_CATEGORIES.find((c) => c.slug === slug);

/**
 * Сколько дней после последнего упоминания товар видят гости. Мастера каждый день публикуют «наличие» и этим держат
 * товар живым; про остаток на сегодня мы не обещаем.
 */
export const PRODUCT_TTL_DAYS = 30;

/**
 * С какого числа мастеров с опубликованными товарами в городе мини-приложение показывает вход в раздел «Товары».
 * Было 15 (#184); 2026-11-26 в Дананге товары у 6 мастеров и 100 позиций в шести категориях — раздел уже полезен, вкладку открыли с 5.
 */
export const PRODUCTS_MIN_HOSTS = 5;

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

const PRODUCT_CATEGORY_HINT = 'Product category: bakery — cakes, desserts, bread; frozen — dumplings and other frozen semi-finished food; meals — cooked meals for today; dairy — cottage cheese, sour cream, kefir, cheese; pantry — preserves, pickles, sauces, cured meat and fish; drinks — kombucha, mors, kvass; farm — vegetables, fruit, eggs, honey grown by the seller; cosmetics — handmade soap and skincare; wear — handmade clothes, jewelry, bags; decor — candles, ceramics, decor, gifts.';

const pagination = {
  pagination_cursor: z.string().max(200).optional().describe('next_cursor from the previous page'),
  pagination_limit: z.coerce.number().int().min(1).max(100).optional().describe('Default 50'),
};

export const ProductListInput = z.object({
  city_id: cityId.optional(),
  category: z.enum(PRODUCT_CATEGORY_SLUGS).optional().describe(PRODUCT_CATEGORY_HINT + ' Omit for all'),
  ...pagination,
});
export type ProductListInput = z.infer<typeof ProductListInput>;

/** Опубликованные товары города и соседей не старше PRODUCT_TTL_DAYS, свежие сверху — форма списков Luma. */
export interface ProductList {
  entries: ProductItem[];
  has_more: boolean;
  next_cursor: string | null;
  hosts_count: number; // сколько мастеров с такими товарами в городе и у соседей, без учёта category: вход в раздел — от PRODUCTS_MIN_HOSTS
  categories: ProductCategory[]; // у каких категорий в городе и у соседей есть товары, без учёта category: плашки пустых не показываем
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
    category: z.enum(PRODUCT_CATEGORY_SLUGS).describe(PRODUCT_CATEGORY_HINT),
    status: z.enum(PRODUCT_STATUSES).describe('Moderation: pending — waits for the team, published — shown to guests, rejected — never shown'),
  })
  .partial();
export type ProductUpdateInput = z.infer<typeof ProductUpdateInput>;
