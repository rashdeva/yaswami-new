CREATE TABLE "cities" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Всё, что собрано до городов, — Дананг: строка должна появиться раньше внешних ключей.
INSERT INTO "cities" ("id", "name", "timezone") VALUES ('danang', 'Дананг', 'Asia/Ho_Chi_Minh');
--> statement-breakpoint
ALTER TABLE "collected_events" ADD COLUMN "city_id" text DEFAULT 'danang' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "city_id" text DEFAULT 'danang' NOT NULL;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "city_id" text DEFAULT 'danang' NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "city_id" text DEFAULT 'danang' NOT NULL;--> statement-breakpoint
ALTER TABLE "collected_events" ADD CONSTRAINT "collected_events_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hosts" ADD CONSTRAINT "hosts_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;