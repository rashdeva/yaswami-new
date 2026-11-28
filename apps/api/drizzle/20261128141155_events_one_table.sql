-- ADR-0014: собранные события переезжают в events. Порядок важен: колонки → перенос строк и ссылок → удаление старого.
-- Блоки переноса написаны руками поверх сгенерированной схемы.
ALTER TABLE "events" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "place" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "time_tbd" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "display_price" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "url" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "telegram_username" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "whatsapp_phone" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "instagram_username" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "channel" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "announcement" jsonb;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "views" integer;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "reactions" integer;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "cover_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "video_url" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "video_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "video_tries" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_external_id_unique" UNIQUE("external_id");--> statement-breakpoint
ALTER TABLE "guests" DROP CONSTRAINT "guests_approval_status_check";--> statement-breakpoint
ALTER TABLE "guests" ADD CONSTRAINT "guests_approval_status_check" CHECK (approval_status in ('approved', 'maybe', 'declined', 'waitlist', 'pending_approval'));--> statement-breakpoint

-- Куда переезжает каждое собранное событие: подтверждённое — в событие организатора (копию, созданную при «это моё»),
-- остальные — в новую строку с id = прежний адрес /e/<id> (collectedSlug в @yaswami/core).
CREATE TEMP TABLE "_moved" ON COMMIT DROP AS
SELECT c.external_id,
  CASE WHEN c.external_id LIKE 'instagram:%' THEN regexp_replace(c.external_id, '^instagram:(.+)#(\d+)$', 'ig.\1-\2')
       ELSE regexp_replace(regexp_replace(c.external_id, '^telegram:', ''), '/(\d+)#(\d+)$', '-\1-\2') END AS slug,
  c.claimed_event_id
FROM "collected_events" c;--> statement-breakpoint
ALTER TABLE "_moved" ADD COLUMN "event_id" text;--> statement-breakpoint
UPDATE "_moved" SET "event_id" = coalesce("claimed_event_id", "slug");--> statement-breakpoint

INSERT INTO "events" ("id", "user_id", "kind", "name", "description", "start_at", "end_at", "timezone", "city_id", "geo_address_json",
  "topic", "what_happens", "for_whom", "beginner_friendly", "takeaway", "status", "platform", "visibility", "showcase_status",
  "created_at", "place", "time_tbd", "display_price", "tags", "url", "telegram_username", "whatsapp_phone", "instagram_username",
  "external_id", "channel", "announcement", "views", "reactions", "cover_checked_at", "video_url", "video_at", "video_tries",
  "published_at", "updated_at")
SELECT m.slug, NULL, 'o', c.event->>'title', nullif(c.event->>'description', ''), c.starts_at, c.ends_at, ci.timezone, c.city_id,
  CASE WHEN nullif(c.event->>'address', '') IS NOT NULL THEN jsonb_build_object('address', c.event->>'address') END,
  c.event->>'topic',
  CASE WHEN jsonb_typeof(c.event->'what_happens') = 'array' THEN c.event->'what_happens' ELSE '[]'::jsonb END,
  c.event->>'for_whom', (c.event->>'beginner_friendly')::boolean, c.event->>'takeaway',
  'published', 'external', 'public', c.status,
  c.created_at, nullif(c.event->>'place', ''), c.event->>'starts_at' LIKE '%T00:00:00%', nullif(c.event->>'price', ''),
  CASE WHEN jsonb_typeof(c.event->'tags') = 'array' THEN c.event->'tags' ELSE '[]'::jsonb END,
  nullif(c.event->>'url', ''), c.telegram_username, nullif(c.event->>'whatsapp_phone', ''),
  nullif(lower(regexp_replace(c.event->>'instagram_username', '^@', '')), ''),
  c.external_id, c.channel, c.announcement, c.views, c.reactions, c.cover_checked_at, c.video_url, c.video_at, c.video_tries,
  c.published_at, c.updated_at
FROM "collected_events" c JOIN "_moved" m USING (external_id) JOIN "cities" ci ON ci.id = c.city_id
WHERE c.claimed_event_id IS NULL;--> statement-breakpoint

-- Подтверждённая пара склеивается: событие организатора получает данные анонса и решение команды об афише.
UPDATE "events" e SET
  "external_id" = c.external_id, "channel" = c.channel, "announcement" = c.announcement, "visibility" = 'public', "showcase_status" = c.status,
  "place" = nullif(c.event->>'place', ''), "time_tbd" = c.event->>'starts_at' LIKE '%T00:00:00%', "display_price" = nullif(c.event->>'price', ''),
  "tags" = CASE WHEN jsonb_typeof(c.event->'tags') = 'array' THEN c.event->'tags' ELSE '[]'::jsonb END,
  "url" = nullif(c.event->>'url', ''), "telegram_username" = c.telegram_username, "whatsapp_phone" = nullif(c.event->>'whatsapp_phone', ''),
  "instagram_username" = nullif(lower(regexp_replace(c.event->>'instagram_username', '^@', '')), ''),
  "views" = c.views, "reactions" = c.reactions, "cover_checked_at" = c.cover_checked_at, "video_url" = c.video_url, "video_at" = c.video_at,
  "video_tries" = c.video_tries, "published_at" = c.published_at
FROM "collected_events" c WHERE c.claimed_event_id = e.id;--> statement-breakpoint

-- Обложка: у склеенной пары остаётся обложка события организатора, если она есть.
DELETE FROM "photos" p USING "_moved" m
WHERE p.collected_external_id = m.external_id AND EXISTS (SELECT 1 FROM "photos" q WHERE q.event_id = m.event_id);--> statement-breakpoint
UPDATE "photos" p SET "event_id" = m.event_id, "collected_external_id" = NULL FROM "_moved" m WHERE p.collected_external_id = m.external_id;--> statement-breakpoint
UPDATE "visits" v SET "event_id" = m.event_id, "collected_external_id" = NULL FROM "_moved" m WHERE v.collected_external_id = m.external_id;--> statement-breakpoint

-- Нажавшие «Записаться» становятся гостями, которых организатор ещё не подтвердил.
INSERT INTO "guests" ("event_id", "user_id", "approval_status", "event_ticket_type_id", "plus_ones", "registered_at")
SELECT m.event_id, s.user_id, 'pending_approval', NULL, 0, s.created_at
FROM "collected_event_signups" s JOIN "_moved" m USING (external_id)
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- Ручные полки хранят id событий: у склеенных пар он сменился с адреса анонса на id события организатора.
UPDATE "shelves" s SET "event_ids" = (
  SELECT coalesce(jsonb_agg(coalesce(m.event_id, x.id) ORDER BY x.n), '[]'::jsonb)
  FROM jsonb_array_elements_text(s.event_ids) WITH ORDINALITY x(id, n) LEFT JOIN "_moved" m ON m.slug = x.id
) WHERE jsonb_array_length(s.event_ids) > 0;--> statement-breakpoint

-- Снимки в журнале сделаны со строк старой таблицы: восстановить их в events нельзя.
UPDATE "admin_actions" SET "undoable" = false WHERE "entity" = 'collected_event' AND "undoable";--> statement-breakpoint

ALTER TABLE "photos" DROP CONSTRAINT "photos_collected_external_id_unique";--> statement-breakpoint
ALTER TABLE "photos" DROP CONSTRAINT "photos_owner_check";--> statement-breakpoint
ALTER TABLE "visits" DROP CONSTRAINT "visits_target_check";--> statement-breakpoint
ALTER TABLE "photos" DROP CONSTRAINT "photos_collected_external_id_collected_events_external_id_fk";--> statement-breakpoint
ALTER TABLE "visits" DROP CONSTRAINT "visits_collected_external_id_collected_events_external_id_fk";--> statement-breakpoint
DROP INDEX "visits_collected_idx";--> statement-breakpoint
ALTER TABLE "photos" DROP COLUMN "collected_external_id";--> statement-breakpoint
ALTER TABLE "visits" DROP COLUMN "collected_external_id";--> statement-breakpoint
ALTER TABLE "visits" ALTER COLUMN "event_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_owner_check" CHECK (num_nonnulls("photos"."user_id", "photos"."event_id") = 1);--> statement-breakpoint
DROP TABLE "collected_event_signups" CASCADE;--> statement-breakpoint
DROP TABLE "collected_events" CASCADE;--> statement-breakpoint
CREATE INDEX "events_start_idx" ON "events" USING btree ("start_at");--> statement-breakpoint
CREATE INDEX "events_username_idx" ON "events" USING btree ("telegram_username");
