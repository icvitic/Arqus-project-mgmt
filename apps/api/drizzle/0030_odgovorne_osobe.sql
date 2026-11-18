ALTER TABLE "team_members" ADD CONSTRAINT "team_members_project_id_uq" UNIQUE("tenant_id","project_id","id");--> statement-breakpoint
ALTER TABLE "deliverables" ADD COLUMN "responsible_member_id" uuid;--> statement-breakpoint
ALTER TABLE "milestones" ADD COLUMN "responsible_member_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "responsible_member_id" uuid;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_responsible_fk" FOREIGN KEY ("tenant_id","project_id","responsible_member_id") REFERENCES "public"."team_members"("tenant_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_responsible_fk" FOREIGN KEY ("tenant_id","project_id","responsible_member_id") REFERENCES "public"."team_members"("tenant_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_responsible_fk" FOREIGN KEY ("tenant_id","project_id","responsible_member_id") REFERENCES "public"."team_members"("tenant_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deliverables_responsible_idx" ON "deliverables" USING btree ("tenant_id","responsible_member_id");--> statement-breakpoint
CREATE INDEX "milestones_responsible_idx" ON "milestones" USING btree ("tenant_id","responsible_member_id");--> statement-breakpoint
CREATE INDEX "tasks_responsible_idx" ON "tasks" USING btree ("tenant_id","responsible_member_id");
