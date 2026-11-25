ALTER TABLE "topics" ADD COLUMN "direction" text;--> statement-breakpoint
-- Темы по направлениям (DIRECTIONS в packages/core/src/topics.ts). Новые темы направление получают от хранителя тем.
UPDATE "topics" SET "direction" = 'body' WHERE "name" IN ('йога', 'дыхательные практики', 'цигун', 'баня', 'телесные практики');--> statement-breakpoint
UPDATE "topics" SET "direction" = 'sport' WHERE "name" IN ('спорт', 'танцы');--> statement-breakpoint
UPDATE "topics" SET "direction" = 'creative' WHERE "name" IN ('творчество', 'музыка', 'кино');--> statement-breakpoint
UPDATE "topics" SET "direction" = 'social' WHERE "name" IN ('игры', 'мафия', 'квизы', 'встречи и общение');--> statement-breakpoint
UPDATE "topics" SET "direction" = 'growth' WHERE "name" IN ('обучение', 'английский язык', 'психологические группы');--> statement-breakpoint
UPDATE "topics" SET "direction" = 'travel' WHERE "name" IN ('путешествия');--> statement-breakpoint
UPDATE "topics" SET "direction" = 'kids' WHERE "name" IN ('детям');
