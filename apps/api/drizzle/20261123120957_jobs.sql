CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_id" text DEFAULT 'danang' NOT NULL,
	"title" text NOT NULL,
	"employer" text,
	"description" text,
	"pay" text,
	"telegram_username" text NOT NULL,
	"announcement" jsonb NOT NULL,
	"author_id" bigint,
	"text_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_status_check" CHECK ("jobs"."status" in ('pending', 'published', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_text_idx" ON "jobs" USING btree ("city_id","text_hash");--> statement-breakpoint
CREATE INDEX "jobs_list_idx" ON "jobs" USING btree ("status","posted_at");