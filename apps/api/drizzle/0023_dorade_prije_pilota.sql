ALTER TABLE "project_budgets" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "reimbursement_claims" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "timesheets" ADD COLUMN "submitted_by" uuid;--> statement-breakpoint
ALTER TABLE "timesheets" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
-- WP1.14b: četiri oka – predavatelj timesheeta. Postojeći predani i odobreni timesheetovi dobivaju predavatelja iz revizijskog
-- zapisa predaje (zadnji zapis 'submit'), a predani bez zapisa iz `updated_by` (predaja je zadnja izmjena predanog timesheeta).
UPDATE "timesheets" t SET "submitted_by" = (SELECT a."actor_id" FROM "audit_entries" a
  WHERE a."tenant_id" = t."tenant_id" AND a."entity" = 'timesheet' AND a."entity_id" = t."id"::text AND a."action" = 'submit' ORDER BY a."at" DESC, a."id" DESC LIMIT 1)
  WHERE t."submitted_at" IS NOT NULL;--> statement-breakpoint
UPDATE "timesheets" SET "submitted_by" = "updated_by" WHERE "status" = 'submitted' AND "submitted_by" IS NULL;--> statement-breakpoint
-- WP1.14b: jedinstvenost dodjele uloge (korisnik, uloga, opseg). Postojeći duplikati se uklanjaju (ostaje najstarija dodjela)
-- prije stvaranja ograničenja, da se migracija ne sruši na instalaciji koja ih već ima; uklanjanje se upisuje u reviziju.
INSERT INTO "audit_entries" ("tenant_id", "actor_type", "entity", "entity_id", "action", "diff")
  SELECT d."tenant_id", 'system', 'role_assignment', d."id"::text, 'revoke.duplicate', jsonb_build_object('before', jsonb_build_object('userId', d."user_id", 'roleId', d."role_id", 'projectId', d."project_id"), 'meta', jsonb_build_object('source', 'migracija 0023'))
  FROM (SELECT ra.*, row_number() OVER (PARTITION BY ra."tenant_id", ra."user_id", ra."role_id", ra."project_id" ORDER BY ra."created_at", ra."id") AS n FROM "role_assignments" ra) d
  WHERE d.n > 1;--> statement-breakpoint
DELETE FROM "role_assignments" ra USING (
  SELECT "id", row_number() OVER (PARTITION BY "tenant_id", "user_id", "role_id", "project_id" ORDER BY "created_at", "id") AS n FROM "role_assignments"
) d WHERE ra."id" = d."id" AND d.n > 1;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_scope_uq" UNIQUE NULLS NOT DISTINCT("tenant_id","user_id","role_id","project_id");