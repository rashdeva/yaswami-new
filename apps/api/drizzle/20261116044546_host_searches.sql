CREATE TABLE "host_search_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"search_id" uuid NOT NULL,
	"chat" text NOT NULL,
	"message_id" integer NOT NULL,
	"url" text NOT NULL,
	"author_id" bigint NOT NULL,
	"author_name" text NOT NULL,
	"author_username" text,
	"text" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "host_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"query" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"keywords" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "host_searches_status_check" CHECK ("host_searches"."status" in ('suggested', 'active', 'paused'))
);
--> statement-breakpoint
ALTER TABLE "host_search_matches" ADD CONSTRAINT "host_search_matches_search_id_host_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."host_searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_searches" ADD CONSTRAINT "host_searches_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "host_search_matches_message_idx" ON "host_search_matches" USING btree ("search_id","chat","message_id");--> statement-breakpoint
CREATE INDEX "host_search_matches_created_idx" ON "host_search_matches" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "host_searches_host_idx" ON "host_searches" USING btree ("host_id");