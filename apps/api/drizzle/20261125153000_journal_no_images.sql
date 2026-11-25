-- Журнал админки хранил обложку, вставленную через admin_covers_set, целиком: data URL на 0,5–1 МБ в каждой строке.
-- 25.11.2026 такие строки помогли переполнить диск базы. Картинка уже лежит в photos; в журнале оставляем пометку.
UPDATE "admin_actions"
SET "input" = jsonb_set("input", '{image_url}', to_jsonb('data:… (' || length("input"->>'image_url') || ' символов)'))
WHERE "input"->>'image_url' LIKE 'data:%';
