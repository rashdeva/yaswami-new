-- Направления — по образцу категорий Luma (DIRECTIONS в packages/core/src/topics.ts): старые slug переезжают в новые.
-- Сначала темы, которые меняют направление по смыслу, потом остальные — целыми направлениями.
UPDATE "topics" SET "direction" = 'wellness' WHERE "name" = 'психологические группы' AND "direction" = 'growth';--> statement-breakpoint
UPDATE "topics" SET "direction" = 'games' WHERE "direction" = 'social' AND "name" <> 'встречи и общение';--> statement-breakpoint
UPDATE "topics" SET "direction" = 'wellness' WHERE "direction" = 'body';--> statement-breakpoint
UPDATE "topics" SET "direction" = 'fitness' WHERE "direction" = 'sport';--> statement-breakpoint
UPDATE "topics" SET "direction" = 'arts' WHERE "direction" IN ('creative', 'shows');--> statement-breakpoint
UPDATE "topics" SET "direction" = 'learning' WHERE "direction" = 'growth';--> statement-breakpoint
UPDATE "topics" SET "direction" = 'family' WHERE "direction" = 'kids';
