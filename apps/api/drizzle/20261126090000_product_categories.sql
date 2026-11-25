-- Категории товаров (ADR-0013) вместо food/handmade. Опубликованных товаров на проде нет, поэтому старые не переразмечаем,
-- а собираем заново: товары удаляются, отметки источников товаров сбрасываются — сборщик перечитает их свежие посты.
DELETE FROM "products";--> statement-breakpoint
DELETE FROM "collector_cursors" WHERE "channel" LIKE 'product:%';--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_category_check";--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_check" CHECK (category in ('bakery', 'frozen', 'meals', 'dairy', 'pantry', 'drinks', 'farm', 'cosmetics', 'wear', 'decor'));