ALTER TABLE "reporting_periods" ADD CONSTRAINT "reporting_periods_tenant_id_uq" UNIQUE("tenant_id","id");--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"category_code" text NOT NULL,
	"work_package_id" uuid,
	"date" date NOT NULL,
	"description" text NOT NULL,
	"supplier" text,
	"amount_cents" bigint NOT NULL,
	"evidence_ref" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"timesheet_id" uuid,
	"claim_id" uuid,
	"status" text DEFAULT 'recorded' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "expenses_amount_ck" CHECK (amount_cents >= 0),
	CONSTRAINT "expenses_claim_status_ck" CHECK ((status = 'recorded') = (claim_id is null))
);--> statement-breakpoint
CREATE TABLE "reimbursement_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"reporting_period_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"totals" jsonb,
	"requested_cents" bigint,
	"approved_cents" bigint,
	"paid_cents" bigint,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"paid_at" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "reimbursement_claims_tenant_id_uq" UNIQUE("tenant_id","id")
);--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"user_id" uuid,
	"full_name" text NOT NULL,
	"role" text,
	"annual_cost_cents" bigint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "team_members_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "team_members_cost_ck" CHECK (annual_cost_cents >= 0)
);--> statement-breakpoint
CREATE TABLE "timesheet_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"timesheet_id" uuid NOT NULL,
	"day" integer NOT NULL,
	"work_package_id" uuid,
	"minutes" integer NOT NULL,
	CONSTRAINT "timesheet_entries_ck" CHECK (day between 1 and 31 and minutes between 0 and 1440)
);--> statement-breakpoint
CREATE TABLE "timesheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"team_member_id" uuid NOT NULL,
	"month" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "timesheets_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "timesheets_month_ck" CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_partner_fk" FOREIGN KEY ("tenant_id","partner_id") REFERENCES "public"."project_partners"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_wp_fk" FOREIGN KEY ("tenant_id","work_package_id") REFERENCES "public"."work_packages"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_timesheet_fk" FOREIGN KEY ("tenant_id","timesheet_id") REFERENCES "public"."timesheets"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_claim_fk" FOREIGN KEY ("tenant_id","claim_id") REFERENCES "public"."reimbursement_claims"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursement_claims" ADD CONSTRAINT "reimbursement_claims_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursement_claims" ADD CONSTRAINT "reimbursement_claims_period_fk" FOREIGN KEY ("tenant_id","reporting_period_id") REFERENCES "public"."reporting_periods"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursement_claims" ADD CONSTRAINT "reimbursement_claims_partner_fk" FOREIGN KEY ("tenant_id","partner_id") REFERENCES "public"."project_partners"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_partner_fk" FOREIGN KEY ("tenant_id","partner_id") REFERENCES "public"."project_partners"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_ts_fk" FOREIGN KEY ("tenant_id","timesheet_id") REFERENCES "public"."timesheets"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_wp_fk" FOREIGN KEY ("tenant_id","work_package_id") REFERENCES "public"."work_packages"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_member_fk" FOREIGN KEY ("tenant_id","team_member_id") REFERENCES "public"."team_members"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_project_date_idx" ON "expenses" USING btree ("project_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "reimbursement_claims_period_partner_uq" ON "reimbursement_claims" USING btree ("reporting_period_id","partner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_user_uq" ON "team_members" USING btree ("project_id","user_id") WHERE user_id is not null;--> statement-breakpoint
CREATE INDEX "timesheet_entries_ts_idx" ON "timesheet_entries" USING btree ("timesheet_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timesheets_member_month_uq" ON "timesheets" USING btree ("team_member_id","month");
