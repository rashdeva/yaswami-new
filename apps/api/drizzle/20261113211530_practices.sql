-- Practice переезжает из jsonb-массива hosts.practices в свою таблицу: у неё появляется id, по которому на неё
-- записываются и команда принимает решение. Раньше ключом было название: переименование теряло записи, а два решения
-- подряд по услугам одного мастера затирали друг друга (список уходил целиком).
CREATE TABLE "practices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"title" text NOT NULL,
	"topic" text NOT NULL,
	"description" text,
	"price" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "practices" ADD CONSTRAINT "practices_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "practices_host_idx" ON "practices" USING btree ("host_id");--> statement-breakpoint
-- Перенос: порядок в массиве становится position. Practice без названия или темы в каталоге и так не показать.
INSERT INTO "practices" ("host_id", "title", "topic", "description", "price", "status", "position")
SELECT h."id", p.value->>'title', p.value->>'topic', p.value->>'description', p.value->>'price', coalesce(p.value->>'status', 'pending'), p.n - 1
FROM "hosts" h, jsonb_array_elements(h."practices") WITH ORDINALITY AS p(value, n)
WHERE p.value->>'title' IS NOT NULL AND p.value->>'topic' IS NOT NULL;--> statement-breakpoint
ALTER TABLE "practice_signups" ADD COLUMN "practice_id" uuid;--> statement-breakpoint
-- Запись находит свою Practice по прежнему ключу — организатору и названию; при одинаковых названиях — первую по порядку.
UPDATE "practice_signups" s SET "practice_id" = (
  SELECT p."id" FROM "practices" p WHERE p."host_id" = s."host_id" AND p."title" = s."title" ORDER BY p."position" LIMIT 1
);--> statement-breakpoint
-- Записи на Practice, которой уже нет (её переименовали или убрали), привязать не к чему.
DELETE FROM "practice_signups" WHERE "practice_id" IS NULL;--> statement-breakpoint
ALTER TABLE "practice_signups" DROP CONSTRAINT "practice_signups_host_id_user_id_title_pk";--> statement-breakpoint
-- Две записи одного человека на одноимённые Practice одного организатора сошлись бы в одну строку ключа.
DELETE FROM "practice_signups" a USING "practice_signups" b
WHERE a."practice_id" = b."practice_id" AND a."user_id" = b."user_id" AND a.ctid > b.ctid;--> statement-breakpoint
ALTER TABLE "practice_signups" ALTER COLUMN "practice_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "practice_signups" ADD CONSTRAINT "practice_signups_practice_id_user_id_pk" PRIMARY KEY("practice_id","user_id");--> statement-breakpoint
ALTER TABLE "practice_signups" ADD CONSTRAINT "practice_signups_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "practice_signups_host_idx" ON "practice_signups" USING btree ("host_id");--> statement-breakpoint
ALTER TABLE "practice_signups" DROP COLUMN "title";--> statement-breakpoint
ALTER TABLE "hosts" DROP COLUMN "practices";--> statement-breakpoint
-- Снимки организаторов в журнале действий сняты по прежней схеме: вернуть по ним организатора уже нельзя.
UPDATE "admin_actions" SET "undoable" = false WHERE "entity" = 'host' AND "undoable";
