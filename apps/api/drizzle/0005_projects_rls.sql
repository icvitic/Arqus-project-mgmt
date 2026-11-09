GRANT SELECT, INSERT, UPDATE, DELETE ON organisations, projects, project_partners, reporting_periods TO arqus_app;
--> statement-breakpoint
ALTER TABLE organisations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organisations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organisations_tenant ON organisations USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY projects_tenant ON projects USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE project_partners ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_partners FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY project_partners_tenant ON project_partners USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE reporting_periods ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE reporting_periods FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY reporting_periods_tenant ON reporting_periods USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
