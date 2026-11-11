ALTER TABLE "collected_events" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
-- Всё, что уже было в ленте до появления модерации, остаётся опубликованным; на проверку идут только новые события.
UPDATE "collected_events" SET "status" = 'published';