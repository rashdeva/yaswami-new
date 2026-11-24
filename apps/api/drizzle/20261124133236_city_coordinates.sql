ALTER TABLE "users" ALTER COLUMN "city_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "city_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cities" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "cities" ADD COLUMN "longitude" double precision;