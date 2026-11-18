CREATE TABLE "retention_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"day" date NOT NULL,
	"mode" text NOT NULL,
	"outcome" text DEFAULT 'claimed' NOT NULL,
	"result" jsonb,
	"created_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "retention_runs_mode_ck" CHECK (mode in ('scheduled', 'dry') and outcome in ('claimed', 'done', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "pseudonym" text;--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "anonymised_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "anonymised_by" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "closed_by" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "retention_runs_scheduled_uq" ON "retention_runs" USING btree ("tenant_id","day") WHERE mode = 'scheduled';--> statement-breakpoint
CREATE INDEX "retention_runs_tenant_idx" ON "retention_runs" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_pseudonym_uq" ON "team_members" USING btree ("project_id","pseudonym") WHERE pseudonym is not null;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_anonymised_ck" CHECK ((anonymised_at is null) = (pseudonym is null) and (anonymised_at is null or (user_id is null and full_name = pseudonym)));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_closed_ck" CHECK ((status = 'closed') = (closed_at is not null));