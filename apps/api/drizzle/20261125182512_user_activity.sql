CREATE TABLE "user_activity" (
	"user_id" bigint PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"joined_via" text,
	"start_param" text,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "user_activity_joined_via_check" CHECK (joined_via in ('mini_app', 'bot', 'site', 'mobile_app'))
);
--> statement-breakpoint
ALTER TABLE "user_activity" ADD CONSTRAINT "user_activity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "user_activity_created_idx" ON "user_activity" USING btree ("created_at");--> statement-breakpoint
-- Уже пришедшим: время прихода — первый способ входа; откуда — неизвестно (null). Последний заход до сих пор не
-- записывался — берём самое позднее, что от человека осталось: заход на событие, ответ, запись в каталоге или на услугу.
INSERT INTO "user_activity" ("user_id", "created_at", "last_seen_at")
SELECT u."id",
  coalesce((SELECT min(i."created_at") FROM "user_identities" i WHERE i."user_id" = u."id"), now()),
  greatest(
    (SELECT max(v."created_at") FROM "visits" v WHERE v."user_id" = u."id"),
    (SELECT max(g."registered_at") FROM "guests" g WHERE g."user_id" = u."id"),
    (SELECT max(c."created_at") FROM "collected_event_signups" c WHERE c."user_id" = u."id"),
    (SELECT max(p."created_at") FROM "practice_signups" p WHERE p."user_id" = u."id")
  )
FROM "users" u;
