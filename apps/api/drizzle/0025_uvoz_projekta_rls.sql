-- WP1.17: povijest uvoza projekta iz Excela. Aplikacija zapis dodaje i označava poništenim, ali ga ne briše.
GRANT SELECT, INSERT, UPDATE ON project_imports TO arqus_app;
--> statement-breakpoint
ALTER TABLE project_imports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_imports FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY project_imports_tenant ON project_imports USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
-- WP1.17: nepromjenjivost troškova potraživanih izvan sustava (status 'historic'). Računaju se u ostvareno s priznatim
-- iznosom, pa ih ne smije promijeniti ni greška u kodu ni izravan upit aplikacijske uloge. Jedina iznimka je brisanje pri
-- poništavanju uvoza koji ih je stvorio: transakcija mora najaviti taj uvoz (`set_config('app.import_undo', <id uvoza>, true)`).
-- Pravila za odlučene troškove (0021) ostaju, a ispravak odluke ne smije mijenjati ni nove stupce (oznaka zahtjeva, osoba, uvoz).
CREATE OR REPLACE FUNCTION expenses_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'historic' THEN
    IF TG_OP = 'DELETE' AND OLD.import_id IS NOT NULL AND OLD.import_id::text = current_setting('app.import_undo', true) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Trošak potraživan izvan sustava je nepromjenjiv (uklanja se samo poništavanjem uvoza)' USING ERRCODE = '23514';
  END IF;
  IF OLD.status IN ('accepted', 'partially_accepted', 'rejected') THEN
    IF TG_OP = 'UPDATE'
       AND OLD.claim_id IS NOT NULL
       AND OLD.claim_id::text = current_setting('app.claim_correction', true)
       AND NEW.status IN ('accepted', 'partially_accepted', 'rejected')
       AND (NEW.id, NEW.tenant_id, NEW.project_id, NEW.partner_id, NEW.category_code, NEW.work_package_id, NEW.date, NEW.description,
            NEW.supplier, NEW.amount_cents, NEW.evidence_ref, NEW.source, NEW.timesheet_id, NEW.claim_id, NEW.created_at, NEW.created_by, NEW.deleted_at,
            NEW.external_claim, NEW.team_member_id, NEW.import_id)
           IS NOT DISTINCT FROM
           (OLD.id, OLD.tenant_id, OLD.project_id, OLD.partner_id, OLD.category_code, OLD.work_package_id, OLD.date, OLD.description,
            OLD.supplier, OLD.amount_cents, OLD.evidence_ref, OLD.source, OLD.timesheet_id, OLD.claim_id, OLD.created_at, OLD.created_by, OLD.deleted_at,
            OLD.external_claim, OLD.team_member_id, OLD.import_id)
    THEN
      IF (NEW.recognised_cents, NEW.decision_reason, NEW.status) IS DISTINCT FROM (OLD.recognised_cents, OLD.decision_reason, OLD.status) THEN
        INSERT INTO audit_entries (tenant_id, actor_type, actor_id, entity, entity_id, action, diff)
        VALUES (OLD.tenant_id, 'system', NEW.updated_by, 'expense', OLD.id::text, 'recognition.correct', jsonb_build_object(
          'before', jsonb_build_object('status', OLD.status, 'recognised', OLD.recognised_cents, 'reason', OLD.decision_reason),
          'after', jsonb_build_object('status', NEW.status, 'recognised', NEW.recognised_cents, 'reason', NEW.decision_reason),
          'meta', jsonb_build_object('claimId', OLD.claim_id, 'source', 'expenses_immutable_trg')));
      END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Trošak u statusu % je nepromjenjiv', OLD.status USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
