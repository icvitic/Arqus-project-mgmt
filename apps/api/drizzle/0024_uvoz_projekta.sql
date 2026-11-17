CREATE TABLE "project_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"file_sha256" text NOT NULL,
	"file_size" integer NOT NULL,
	"format" text NOT NULL,
	"status" text DEFAULT 'applied' NOT NULL,
	"counts" jsonb NOT NULL,
	"created" jsonb NOT NULL,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"undone_at" timestamp with time zone,
	"undone_by" uuid,
	CONSTRAINT "project_imports_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "project_imports_status_ck" CHECK (status in ('applied', 'undone') and (status = 'undone') = (undone_at is not null)),
	CONSTRAINT "project_imports_format_ck" CHECK (format in ('xlsx', 'csv'))
);
--> statement-breakpoint
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_claim_status_ck";--> statement-breakpoint
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_decision_ck";--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "external_claim" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "team_member_id" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "import_id" uuid;--> statement-breakpoint
ALTER TABLE "project_imports" ADD CONSTRAINT "project_imports_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_imports_project_idx" ON "project_imports" USING btree ("project_id","created_at");--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_member_fk" FOREIGN KEY ("tenant_id","team_member_id") REFERENCES "public"."team_members"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_import_idx" ON "expenses" USING btree ("import_id");--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_historic_ck" CHECK ((source <> 'historic_personnel' or (status = 'historic' and team_member_id is not null))
    and (source = 'historic_personnel' or team_member_id is null) and (external_claim is null or status = 'historic'));--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_claim_status_ck" CHECK ((status in ('recorded', 'historic')) = (claim_id is null));--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_decision_ck" CHECK ((status = 'historic' and (recognised_cents is null or recognised_cents between 0 and amount_cents))
    or (status <> 'historic' and (status in ('accepted', 'partially_accepted', 'rejected')) = (recognised_cents is not null)
    and (recognised_cents is null or recognised_cents between 0 and amount_cents)
    and (status <> 'accepted' or recognised_cents = amount_cents)
    and (status <> 'rejected' or recognised_cents = 0)
    and (status <> 'partially_accepted' or (recognised_cents > 0 and recognised_cents < amount_cents))));