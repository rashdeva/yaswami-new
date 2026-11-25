CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"price" text,
	"unit" text,
	"category" text NOT NULL,
	"photo_url" text,
	"announcement" jsonb NOT NULL,
	"title_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_status_check" CHECK (status in ('pending', 'published', 'rejected')),
	CONSTRAINT "products_category_check" CHECK (category in ('food', 'handmade'))
);
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "products_host_title_idx" ON "products" USING btree ("host_id","title_key");--> statement-breakpoint
CREATE INDEX "products_list_idx" ON "products" USING btree ("status","posted_at");