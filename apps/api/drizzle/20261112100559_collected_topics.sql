-- Новые Topic «йога» и «игры»: уже собранные события переносим по меткам, чтобы фильтр в ленте сработал сразу.
-- Новые события сборщик относит к ним сам (список Topic в @yaswami/core).
UPDATE "collected_events" SET "event" = jsonb_set("event", '{topic}', '"йога"')
WHERE "event"->>'topic' = 'телесные практики' AND "event"->'tags' ? 'йога';--> statement-breakpoint
UPDATE "collected_events" SET "event" = jsonb_set("event", '{topic}', '"игры"')
WHERE "event"->>'topic' = 'встречи и общение' AND "event"->'tags' ?| array['игры', 'настольные игры', 'шахматы', 'квиз', 'мафия'];
