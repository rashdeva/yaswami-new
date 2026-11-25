ALTER TABLE "photos" ALTER COLUMN "data" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "url" text;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_place_check" CHECK (num_nonnulls("photos"."data", "photos"."url") = 1);