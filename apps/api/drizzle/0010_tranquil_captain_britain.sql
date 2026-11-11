CREATE TABLE "photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" bigint,
	"host_id" uuid,
	"source" text NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photos_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "photos_owner_check" CHECK (num_nonnulls("photos"."user_id", "photos"."host_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "photos_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "photos_host_source_idx" ON "photos" USING btree ("host_id","source");