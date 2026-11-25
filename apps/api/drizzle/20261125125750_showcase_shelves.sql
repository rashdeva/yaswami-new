CREATE TABLE "shelves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_id" text NOT NULL,
	"title" text NOT NULL,
	"topic" text,
	"rule" jsonb,
	"event_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"author" text NOT NULL,
	"note" text,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shelves_status_check" CHECK ("shelves"."status" in ('proposed', 'published', 'hidden')),
	CONSTRAINT "shelves_author_check" CHECK ("shelves"."author" in ('team', 'curator'))
);
--> statement-breakpoint
ALTER TABLE "cities" ADD COLUMN "showcase_mode" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "shelves" ADD CONSTRAINT "shelves_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shelves_city_idx" ON "shelves" USING btree ("city_id","position");