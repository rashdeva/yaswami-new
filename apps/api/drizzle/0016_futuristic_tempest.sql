CREATE TABLE "event_feedback" (
	"event_id" text NOT NULL,
	"user_id" bigint NOT NULL,
	"rating" integer,
	"comment" text,
	"prompt_message_id" integer,
	"host_notified_at" timestamp with time zone,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_feedback_event_id_user_id_pk" PRIMARY KEY("event_id","user_id"),
	CONSTRAINT "event_feedback_rating_check" CHECK ("event_feedback"."rating" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "event_feedback" ADD CONSTRAINT "event_feedback_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_feedback" ADD CONSTRAINT "event_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;