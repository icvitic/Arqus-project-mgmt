GRANT SELECT, INSERT, UPDATE, DELETE ON team_members, timesheets, timesheet_entries, expenses, reimbursement_claims TO arqus_app;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['team_members','timesheets','timesheet_entries','expenses','reimbursement_claims'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t || '_tenant', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- Invarijanta 6: prihvaćen ili odbijen trošak je nepromjenjiv (ispravak = storno + novi zapis). Vrijedi i za grešku u kodu.
CREATE OR REPLACE FUNCTION expenses_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('accepted', 'rejected') THEN
    RAISE EXCEPTION 'Trošak u statusu % je nepromjenjiv', OLD.status USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
--> statement-breakpoint
CREATE TRIGGER expenses_immutable_trg BEFORE UPDATE OR DELETE ON expenses FOR EACH ROW EXECUTE FUNCTION expenses_immutable();
