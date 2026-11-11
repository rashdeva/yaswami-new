ALTER TABLE "photos" DROP CONSTRAINT "photos_owner_check";--> statement-breakpoint
ALTER TABLE "collected_events" ADD COLUMN "cover_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "collected_external_id" text;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_collected_external_id_collected_events_external_id_fk" FOREIGN KEY ("collected_external_id") REFERENCES "public"."collected_events"("external_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_collected_external_id_unique" UNIQUE("collected_external_id");--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_owner_check" CHECK (num_nonnulls("photos"."user_id", "photos"."host_id", "photos"."collected_external_id") = 1);