ALTER TABLE "hosts" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "offer_url" text;