ALTER TABLE "photos" DROP CONSTRAINT "photos_owner_check";--> statement-breakpoint
ALTER TABLE "photos" DROP CONSTRAINT "photos_host_id_hosts_id_fk";
--> statement-breakpoint
DROP INDEX "photos_host_source_idx";--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "photos" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- Фото сообщества переезжают в бакет R2 и в 800px (ADR-0006): превью 320px из Postgres удаляем,
-- а сборщику велим пересмотреть все каналы — он зальёт фото заново.
DELETE FROM "photos" WHERE "host_id" IS NOT NULL;--> statement-breakpoint
UPDATE "hosts" SET "photos_checked_at" = NULL WHERE "channel" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "photos" DROP COLUMN "host_id";--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_owner_check" CHECK (num_nonnulls("photos"."user_id", "photos"."collected_external_id", "photos"."event_id") = 1);