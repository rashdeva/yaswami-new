CREATE TABLE "collected_events" (
	"external_id" text PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"announcement" jsonb NOT NULL,
	"event" jsonb NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"telegram_username" text,
	"signup_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collector_cursors" (
	"channel" text PRIMARY KEY NOT NULL,
	"last_number" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX "collected_events_starts_idx" ON "collected_events" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "collected_events_username_idx" ON "collected_events" USING btree ("telegram_username");