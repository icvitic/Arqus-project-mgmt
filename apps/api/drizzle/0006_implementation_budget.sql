ALTER TABLE "project_partners" ADD CONSTRAINT "project_partners_tenant_id_uq" UNIQUE("tenant_id","id");--> statement-breakpoint
CREATE TABLE "budget_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"budget_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"category_code" text NOT NULL,
	"work_package_id" uuid,
	"amount_cents" bigint NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "budget_lines_amount_ck" CHECK (amount_cents >= 0)
);
--> statement-breakpoint
CREATE TABLE "deliverables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"work_package_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"dissemination" text NOT NULL,
	"due_month" integer NOT NULL,
	"lead_partner_id" uuid,
	"status" text DEFAULT 'planned' NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "deliverables_month_ck" CHECK (due_month >= 1)
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"due_month" integer NOT NULL,
	"verification" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "milestones_month_ck" CHECK (due_month >= 1)
);
--> statement-breakpoint
CREATE TABLE "project_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "project_budgets_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "risks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"description" text NOT NULL,
	"likelihood" integer NOT NULL,
	"impact" integer NOT NULL,
	"mitigation" text,
	"owner_user_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "risks_scale_ck" CHECK (likelihood between 1 and 3 and impact between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"work_package_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"lead_partner_id" uuid,
	"start_month" integer NOT NULL,
	"end_month" integer NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "tasks_months_ck" CHECK (start_month >= 1 and end_month >= start_month)
);
--> statement-breakpoint
CREATE TABLE "work_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"lead_partner_id" uuid,
	"start_month" integer NOT NULL,
	"end_month" integer NOT NULL,
	"objectives" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "work_packages_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "work_packages_months_ck" CHECK (start_month >= 1 and end_month >= start_month)
);
--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_budget_fk" FOREIGN KEY ("tenant_id","budget_id") REFERENCES "public"."project_budgets"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_partner_fk" FOREIGN KEY ("tenant_id","partner_id") REFERENCES "public"."project_partners"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_wp_fk" FOREIGN KEY ("tenant_id","work_package_id") REFERENCES "public"."work_packages"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_wp_fk" FOREIGN KEY ("tenant_id","work_package_id") REFERENCES "public"."work_packages"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_lead_fk" FOREIGN KEY ("tenant_id","lead_partner_id") REFERENCES "public"."project_partners"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_budgets" ADD CONSTRAINT "project_budgets_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_owner_fk" FOREIGN KEY ("tenant_id","owner_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_wp_fk" FOREIGN KEY ("tenant_id","work_package_id") REFERENCES "public"."work_packages"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_lead_fk" FOREIGN KEY ("tenant_id","lead_partner_id") REFERENCES "public"."project_partners"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_packages" ADD CONSTRAINT "work_packages_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_packages" ADD CONSTRAINT "work_packages_lead_fk" FOREIGN KEY ("tenant_id","lead_partner_id") REFERENCES "public"."project_partners"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_lines_budget_idx" ON "budget_lines" USING btree ("budget_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deliverables_number_uq" ON "deliverables" USING btree ("work_package_id","number");--> statement-breakpoint
CREATE INDEX "deliverables_due_idx" ON "deliverables" USING btree ("tenant_id","due_month");--> statement-breakpoint
CREATE UNIQUE INDEX "milestones_number_uq" ON "milestones" USING btree ("project_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "project_budgets_version_uq" ON "project_budgets" USING btree ("project_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "risks_number_uq" ON "risks" USING btree ("project_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_number_uq" ON "tasks" USING btree ("work_package_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "work_packages_number_uq" ON "work_packages" USING btree ("project_id","number");
