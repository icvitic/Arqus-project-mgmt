-- WP1.14: dodjele uloga na projektu (strani ključ na projekt istog stanara) i plaća člana tima koju upisuje tek uloga s personnel:read.
ALTER TABLE "team_members" ALTER COLUMN "annual_cost_cents" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "role_assignments_project_idx" ON "role_assignments" USING btree ("tenant_id","project_id");