-- Вакансии убраны: на их место встаёт раздел товаров мастеров (issue #184). Чаты о работе больше не читаем.
DELETE FROM "sources" WHERE "kind" = 'jobs';--> statement-breakpoint
DROP TABLE "jobs" CASCADE;
