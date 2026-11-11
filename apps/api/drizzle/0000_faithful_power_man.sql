CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"host_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"tz" text NOT NULL,
	"place_text" text NOT NULL,
	"place_url" text,
	"capacity" integer,
	"allow_plus_one" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"widget_id" text,
	"rev" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "events_kind_check" CHECK (kind in ('f', 'b', 'w', 'c', 's', 'o')),
	CONSTRAINT "events_status_check" CHECK (status in ('draft', 'published', 'cancelled')),
	CONSTRAINT "events_capacity_check" CHECK ("events"."capacity" > 0)
);
--> statement-breakpoint
CREATE TABLE "guests" (
	"event_id" text NOT NULL,
	"user_id" bigint NOT NULL,
	"status" text NOT NULL,
	"ticket_type_id" uuid,
	"plus_ones" integer DEFAULT 0 NOT NULL,
	"responded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "guests_event_id_user_id_pk" PRIMARY KEY("event_id","user_id"),
	CONSTRAINT "guests_status_check" CHECK (status in ('going', 'maybe', 'declined', 'waitlist')),
	CONSTRAINT "guests_plus_ones_check" CHECK ("guests"."plus_ones" >= 0),
	CONSTRAINT "guests_ticket_check" CHECK ("guests"."status" not in ('going', 'waitlist') or "guests"."ticket_type_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"kind" text NOT NULL,
	"chat_id" bigint,
	"message_id" integer,
	"inline_message_id" text,
	CONSTRAINT "shares_kind_check" CHECK (kind in ('widget', 'inline_message'))
);
--> statement-breakpoint
CREATE TABLE "ticket_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"max_capacity" integer,
	"is_hidden" boolean DEFAULT false NOT NULL,
	"price_text" text,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ticket_types_max_capacity_check" CHECK ("ticket_types"."max_capacity" > 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" bigint PRIMARY KEY NOT NULL,
	"first_name" text NOT NULL,
	"username" text,
	"lang" text NOT NULL,
	"tz" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guests" ADD CONSTRAINT "guests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guests" ADD CONSTRAINT "guests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guests" ADD CONSTRAINT "guests_ticket_type_id_ticket_types_id_fk" FOREIGN KEY ("ticket_type_id") REFERENCES "public"."ticket_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_host_idx" ON "events" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "guests_user_idx" ON "guests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "shares_event_idx" ON "shares" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "ticket_types_event_idx" ON "ticket_types" USING btree ("event_id");