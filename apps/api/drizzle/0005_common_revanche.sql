CREATE TABLE "collected_event_signups" (
	"external_id" text NOT NULL,
	"user_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collected_event_signups_external_id_user_id_pk" PRIMARY KEY("external_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "collected_event_signups" ADD CONSTRAINT "collected_event_signups_external_id_collected_events_external_id_fk" FOREIGN KEY ("external_id") REFERENCES "public"."collected_events"("external_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collected_event_signups" ADD CONSTRAINT "collected_event_signups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collected_event_signups_user_idx" ON "collected_event_signups" USING btree ("user_id");