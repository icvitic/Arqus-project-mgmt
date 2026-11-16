-- Dokumenti: brisanje je logičko (deleted_at), verzije se samo dodaju – aplikacija nema UPDATE/DELETE nad verzijama.
GRANT SELECT, INSERT, UPDATE ON documents TO arqus_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON document_versions TO arqus_app;
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['documents','document_versions'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t); EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  EXECUTE format('CREATE POLICY %I ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t || '_tenant', t);
END LOOP; END $$;
