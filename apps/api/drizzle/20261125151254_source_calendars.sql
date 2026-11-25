CREATE TABLE "calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text,
	"host_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendars_host_id_unique" UNIQUE("host_id")
);
--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "calendar_id" uuid;--> statement-breakpoint
-- Организатору с источниками — один календарь на все его каналы (Telegram и Instagram).
INSERT INTO "calendars" ("name", "host_id", "created_at")
SELECT h."name", h."id", min(s."created_at") FROM "hosts" h JOIN "sources" s ON s."host_id" = h."id" GROUP BY h."id", h."name";--> statement-breakpoint
UPDATE "sources" s SET "calendar_id" = k."id" FROM "calendars" k WHERE k."host_id" = s."host_id";--> statement-breakpoint
-- Источнику без организатора — свой календарь; имя — ник или username, команда переименует и склеит.
UPDATE "sources" SET "calendar_id" = gen_random_uuid() WHERE "calendar_id" IS NULL;--> statement-breakpoint
INSERT INTO "calendars" ("id", "name", "created_at")
SELECT "calendar_id", regexp_replace("channel", '^instagram:', ''), "created_at" FROM "sources" WHERE "calendar_id" NOT IN (SELECT "id" FROM "calendars");--> statement-breakpoint
ALTER TABLE "sources" ALTER COLUMN "calendar_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE no action ON UPDATE no action;