ALTER TABLE "events" ADD COLUMN "topic" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "what_happens" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "for_whom" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "beginner_friendly" boolean;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "takeaway" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "guide" jsonb;