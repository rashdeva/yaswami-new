CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_user_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" bigint NOT NULL,
	"event_id" text,
	"collected_external_id" text,
	"referrer_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visits_target_check" CHECK (num_nonnulls("visits"."event_id", "visits"."collected_external_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_host_user_id_users_id_fk" FOREIGN KEY ("host_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_collected_external_id_collected_events_external_id_fk" FOREIGN KEY ("collected_external_id") REFERENCES "public"."collected_events"("external_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_referrer_id_users_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_host_user_idx" ON "contacts" USING btree ("host_user_id","user_id");--> statement-breakpoint
CREATE INDEX "visits_event_idx" ON "visits" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "visits_collected_idx" ON "visits" USING btree ("collected_external_id");--> statement-breakpoint
CREATE INDEX "visits_user_idx" ON "visits" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "visits_referrer_idx" ON "visits" USING btree ("referrer_id");