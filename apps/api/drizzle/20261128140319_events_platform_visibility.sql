ALTER TABLE "events" ADD COLUMN "platform" text DEFAULT 'yaswami' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "visibility" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "showcase_status" text;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_platform_check" CHECK (platform in ('yaswami', 'external'));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_visibility_check" CHECK (visibility in ('public', 'private'));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_showcase_status_check" CHECK (showcase_status in ('pending', 'approved', 'published', 'rejected'));