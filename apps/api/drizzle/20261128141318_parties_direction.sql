-- Направление «Вечеринки» (DIRECTIONS в packages/core/src/topics.ts) и тема «вечеринки» в нём: раньше вечеринки
-- расходились по «музыке» и «путешествиям». Иконку темы дорисует иллюстратор.
INSERT INTO "topics" ("name", "slug", "emoji", "color", "what", "why", "first", "not_for", "tags", "origin", "direction", "position")
SELECT 'вечеринки', 'party', '🪩', '#a21caf',
  'Вечера с музыкой и танцами: диджей-сеты в барах и клубах, опен-эйры на пляже, рейвы, экстатик-дэнс, фестивали.',
  'Приходят потанцевать, послушать музыку вживую и провести вечер среди людей.',
  'Посмотри в анонсе время начала, стоимость входа и дресс-код: билет заранее часто дешевле, чем на входе. Прийти одному — нормально. Если вечеринка за городом, узнай заранее, как добираться туда и обратно.',
  'Громко, людно и допоздна. Проверь возрастное ограничение и что входит в цену: напитки и трансфер обычно оплачиваются отдельно.',
  '["вечеринка", "рейв", "open-air", "опен-эйр", "диджей-сет"]'::jsonb, 'team', 'parties',
  (SELECT coalesce(max("position"), 0) + 1 FROM "topics")
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Тема уже была заведена руками — только кладём её в направление.
UPDATE "topics" SET "direction" = 'parties' WHERE "name" = 'вечеринки';--> statement-breakpoint
-- События-вечеринки из «музыки», «путешествий» и без темы — в новую тему, по меткам.
UPDATE "collected_events" SET "event" = jsonb_set("event", '{topic}', to_jsonb('вечеринки'::text))
WHERE "event"->>'topic' IN ('музыка', 'путешествия', 'другое')
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements_text("event"->'tags') t
    WHERE lower(t) IN ('вечеринка', 'рейв', 'open-air', 'openair', 'опен-эйр', 'диджей-сет', 'техно', 'электро', 'электроника')
  );--> statement-breakpoint
-- Подписанные на «музыку» получают и «вечеринки»: иначе они молча перестали бы слышать о части событий.
UPDATE "subscriptions" SET "topics" = "topics" || to_jsonb('вечеринки'::text)
WHERE "topics" ? 'музыка' AND NOT "topics" ? 'вечеринки';--> statement-breakpoint
-- «Игры» и «Обучение» вливаются в «Игры и общение» (`social`): на игру, своп и разговорный клуб идут за компанией.
UPDATE "topics" SET "direction" = 'social' WHERE "direction" IN ('games', 'learning');
