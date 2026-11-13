-- Написана вручную. Новые Topic «детям» и «обучение», «кино и лекции» разделена на «кино» и «обучение»:
-- уже собранные события переносим по меткам, чтобы фильтр в ленте сработал сразу. Новые сборщик относит сам.
UPDATE "collected_events" SET "event" = jsonb_set("event", '{topic}', '"детям"')
WHERE "event"->'tags' ?| array['дети', 'детям', 'для детей'];--> statement-breakpoint
UPDATE "collected_events" SET "event" = jsonb_set("event", '{topic}', '"кино"')
WHERE "event"->>'topic' = 'кино и лекции' AND "event"->'tags' ?| array['кино', 'фильм', 'киноклуб', 'кинопоказ'];--> statement-breakpoint
UPDATE "collected_events" SET "event" = jsonb_set("event", '{topic}', '"обучение"')
WHERE "event"->>'topic' = 'кино и лекции'
   OR ("event"->>'topic' = 'встречи и общение' AND "event"->'tags' ?| array['разговорный клуб', 'английский', 'лекция', 'тренинг', 'мастермайнд']);--> statement-breakpoint
-- У событий Ясвами меток нет: кино узнаём по названию.
UPDATE "events" SET "topic" = CASE WHEN "name" ~* 'кино|фильм|film|movie' THEN 'кино' ELSE 'обучение' END
WHERE "topic" = 'кино и лекции';--> statement-breakpoint
-- Practice организаторов: кино без даты никто не предлагает, старая тема целиком уходит в «обучение».
UPDATE "hosts" SET "practices" = (
  SELECT jsonb_agg(CASE WHEN p->>'topic' = 'кино и лекции' THEN jsonb_set(p, '{topic}', '"обучение"') ELSE p END)
  FROM jsonb_array_elements("practices") p
) WHERE "practices" @> '[{"topic": "кино и лекции"}]';
