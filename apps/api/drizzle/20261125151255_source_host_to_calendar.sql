ALTER TABLE "sources" DROP CONSTRAINT "sources_host_id_hosts_id_fk";
--> statement-breakpoint
ALTER TABLE "sources" DROP COLUMN "host_id";