ALTER TABLE "photos" DROP CONSTRAINT "photos_owner_check";--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "event_id" text;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_event_id_unique" UNIQUE("event_id");--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_owner_check" CHECK (num_nonnulls("photos"."user_id", "photos"."host_id", "photos"."collected_external_id", "photos"."event_id") = 1);