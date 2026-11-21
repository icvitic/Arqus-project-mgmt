-- WP1.26: suradnici na prijavi. Aplikacija dodaje, mijenja razinu pristupa i uklanja suradnika; izolacija po stanaru kao i
-- ostale tablice prijave (stranim ključem i RLS-om).
GRANT SELECT, INSERT, UPDATE, DELETE ON proposal_collaborators TO arqus_app;
--> statement-breakpoint
ALTER TABLE proposal_collaborators ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE proposal_collaborators FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY proposal_collaborators_tenant ON proposal_collaborators USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
