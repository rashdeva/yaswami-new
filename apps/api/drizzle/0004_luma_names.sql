-- Имена полей как в Luma API. Написана вручную: переименования сохраняют данные
-- (drizzle-kit для переименований задаёт вопросы в терминале и без него их не делает).
ALTER TABLE "users" RENAME COLUMN "tz" TO "timezone";--> statement-breakpoint
ALTER TABLE "events" RENAME COLUMN "host_id" TO "user_id";--> statement-breakpoint
ALTER TABLE "events" RENAME COLUMN "title" TO "name";--> statement-breakpoint
ALTER TABLE "events" RENAME COLUMN "starts_at" TO "start_at";--> statement-breakpoint
ALTER TABLE "events" RENAME COLUMN "tz" TO "timezone";--> statement-breakpoint
ALTER TABLE "events" RENAME COLUMN "place_url" TO "meeting_url";--> statement-breakpoint
ALTER TABLE "events" RENAME COLUMN "capacity" TO "max_capacity";--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "end_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "geo_address_json" jsonb;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "events" SET "geo_address_json" = jsonb_build_object('address', left(btrim("place_text"), 80)) WHERE btrim("place_text") <> '';--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN "place_text";--> statement-breakpoint
ALTER TABLE "events" RENAME CONSTRAINT "events_host_id_users_id_fk" TO "events_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "events" RENAME CONSTRAINT "events_capacity_check" TO "events_max_capacity_check";--> statement-breakpoint
ALTER INDEX "events_host_idx" RENAME TO "events_user_idx";--> statement-breakpoint
ALTER TABLE "guests" DROP CONSTRAINT "guests_status_check";--> statement-breakpoint
ALTER TABLE "guests" DROP CONSTRAINT "guests_ticket_check";--> statement-breakpoint
ALTER TABLE "guests" RENAME COLUMN "status" TO "approval_status";--> statement-breakpoint
ALTER TABLE "guests" RENAME COLUMN "ticket_type_id" TO "event_ticket_type_id";--> statement-breakpoint
ALTER TABLE "guests" RENAME COLUMN "responded_at" TO "registered_at";--> statement-breakpoint
UPDATE "guests" SET "approval_status" = 'approved' WHERE "approval_status" = 'going';--> statement-breakpoint
ALTER TABLE "guests" RENAME CONSTRAINT "guests_ticket_type_id_ticket_types_id_fk" TO "guests_event_ticket_type_id_ticket_types_id_fk";--> statement-breakpoint
ALTER TABLE "guests" ADD CONSTRAINT "guests_approval_status_check" CHECK (approval_status in ('approved', 'maybe', 'declined', 'waitlist'));--> statement-breakpoint
ALTER TABLE "guests" ADD CONSTRAINT "guests_ticket_check" CHECK ("guests"."approval_status" not in ('approved', 'waitlist') or "guests"."event_ticket_type_id" is not null);
