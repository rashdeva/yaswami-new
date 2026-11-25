ALTER TABLE "sources" ADD COLUMN "approval_status" text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "submitted_by" bigint;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;