DROP INDEX "user_identities_user_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "user_identities_user_provider_uq" ON "user_identities" USING btree ("user_id","provider");--> statement-breakpoint
-- ADR-0008: Telegram — способ входа, как Apple и Google. У пользователей, заведённых до этого, id равен Telegram id
-- (положительные id): переносим это знание в user_identities. Пользователи Apple и Google (отрицательные id) Telegram не имеют.
INSERT INTO "user_identities" ("provider", "subject", "user_id") SELECT 'telegram', "id"::text, "id" FROM "users" WHERE "id" > 0 ON CONFLICT DO NOTHING;
