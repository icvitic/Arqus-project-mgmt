CREATE TABLE "proposal_budget_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"category_code" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proposal_budget_amount_ck" CHECK (amount_cents >= 0)
);
--> statement-breakpoint
CREATE TABLE "proposal_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"role" text DEFAULT 'partner' NOT NULL,
	"beneficiary_type" text DEFAULT 'default' NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	"order_no" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "proposal_members_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "proposal_work_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"lead_member_id" uuid,
	"start_month" integer NOT NULL,
	"end_month" integer NOT NULL,
	"person_months" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proposal_wp_months_ck" CHECK (start_month >= 1 and end_month >= start_month and person_months >= 0)
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"call_id" uuid,
	"package_row_id" uuid NOT NULL,
	"package_id" text NOT NULL,
	"package_version" text NOT NULL,
	"action_type" text NOT NULL,
	"acronym" text NOT NULL,
	"title" text NOT NULL,
	"role" text DEFAULT 'coordinator' NOT NULL,
	"lead_user_id" uuid,
	"status" text DEFAULT 'idea' NOT NULL,
	"duration_months" integer DEFAULT 36 NOT NULL,
	"internal_deadline" date,
	"budget_version" integer DEFAULT 1 NOT NULL,
	"budget_locked" boolean DEFAULT false NOT NULL,
	"submission" jsonb,
	"outcome" jsonb,
	"project_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "proposals_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "proposals_duration_ck" CHECK (duration_months between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "proposal_budget_lines" ADD CONSTRAINT "proposal_budget_proposal_fk" FOREIGN KEY ("tenant_id","proposal_id") REFERENCES "public"."proposals"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_budget_lines" ADD CONSTRAINT "proposal_budget_member_fk" FOREIGN KEY ("tenant_id","member_id") REFERENCES "public"."proposal_members"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_members" ADD CONSTRAINT "proposal_members_proposal_fk" FOREIGN KEY ("tenant_id","proposal_id") REFERENCES "public"."proposals"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_members" ADD CONSTRAINT "proposal_members_org_fk" FOREIGN KEY ("tenant_id","organisation_id") REFERENCES "public"."organisations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_work_packages" ADD CONSTRAINT "proposal_wp_proposal_fk" FOREIGN KEY ("tenant_id","proposal_id") REFERENCES "public"."proposals"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_work_packages" ADD CONSTRAINT "proposal_wp_lead_fk" FOREIGN KEY ("tenant_id","lead_member_id") REFERENCES "public"."proposal_members"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_package_row_id_programme_packages_id_fk" FOREIGN KEY ("package_row_id") REFERENCES "public"."programme_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_lead_fk" FOREIGN KEY ("tenant_id","lead_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proposal_budget_lines_idx" ON "proposal_budget_lines" USING btree ("proposal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_members_uq" ON "proposal_members" USING btree ("proposal_id","organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_wp_number_uq" ON "proposal_work_packages" USING btree ("proposal_id","number");--> statement-breakpoint
CREATE INDEX "proposals_status_idx" ON "proposals" USING btree ("tenant_id","status");