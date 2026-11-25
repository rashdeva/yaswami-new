ALTER TABLE "cities" ADD COLUMN "launch_status" text DEFAULT 'launched' NOT NULL;--> statement-breakpoint
-- Города Шри-Ланки (20261124133236_sri_lanka_cities) — на паузу: поиск источников набрал там посторонних каналов
-- и съедал суточную квоту ИИ сборщика. Вернуть — launch_status: launched в «Городах».
UPDATE "cities" SET "launch_status" = 'archived' WHERE "timezone" = 'Asia/Colombo';
