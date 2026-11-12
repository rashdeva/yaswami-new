CREATE TABLE "admin_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" bigint NOT NULL,
	"via" text NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"input" jsonb,
	"before" jsonb,
	"after" jsonb,
	"undoable" boolean NOT NULL,
	"undo_of" uuid,
	"undone_by" uuid,
	CONSTRAINT "admin_actions_via_check" CHECK ("admin_actions"."via" in ('admin', 'mcp'))
);
--> statement-breakpoint
CREATE INDEX "admin_actions_created_idx" ON "admin_actions" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "admin_actions_entity_idx" ON "admin_actions" USING btree ("entity","entity_id");