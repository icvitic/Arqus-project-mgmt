GRANT SELECT, INSERT, UPDATE, DELETE ON work_packages, tasks, deliverables, milestones, risks, project_budgets, budget_lines TO arqus_app;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['work_packages','tasks','deliverables','milestones','risks','project_budgets','budget_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t || '_tenant', t);
  END LOOP;
END $$;
