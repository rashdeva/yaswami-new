-- У каждой Practice свой статус модерации. До этого решал статус мастера: у опубликованного Practice были видны,
-- у остальных ждали решения — переносим это как есть.
UPDATE "hosts" SET "practices" = (
  SELECT jsonb_agg(p || jsonb_build_object('status', CASE WHEN "hosts"."status" = 'published' THEN 'published' ELSE 'pending' END))
  FROM jsonb_array_elements("hosts"."practices") p
) WHERE jsonb_array_length("practices") > 0;
