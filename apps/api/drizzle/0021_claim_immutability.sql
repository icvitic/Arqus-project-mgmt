-- WP1.16a: nepromjenjivost odlučenih troškova (invarijanta 6) uz odluku po trošku.
-- Trošak u statusu accepted / partially_accepted / rejected ne mijenja se i ne briše – ni greškom u kodu ni izravnim upitom
-- aplikacijske uloge. Jedina iznimka je namjerni ispravak odluke o ZNS-u: transakcija mora najaviti zahtjev
-- (`set_config('app.claim_correction', <id zahtjeva>, true)`), mijenjati se smiju samo priznati iznos, razlog i status
-- (i dalje odlučen), a okidač sam upisuje revizijski zapis za svaku promjenu – ispravak ne može proći bez traga.
CREATE OR REPLACE FUNCTION expenses_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('accepted', 'partially_accepted', 'rejected') THEN
    IF TG_OP = 'UPDATE'
       AND OLD.claim_id IS NOT NULL
       AND OLD.claim_id::text = current_setting('app.claim_correction', true)
       AND NEW.status IN ('accepted', 'partially_accepted', 'rejected')
       AND (NEW.id, NEW.tenant_id, NEW.project_id, NEW.partner_id, NEW.category_code, NEW.work_package_id, NEW.date, NEW.description,
            NEW.supplier, NEW.amount_cents, NEW.evidence_ref, NEW.source, NEW.timesheet_id, NEW.claim_id, NEW.created_at, NEW.created_by, NEW.deleted_at)
           IS NOT DISTINCT FROM
           (OLD.id, OLD.tenant_id, OLD.project_id, OLD.partner_id, OLD.category_code, OLD.work_package_id, OLD.date, OLD.description,
            OLD.supplier, OLD.amount_cents, OLD.evidence_ref, OLD.source, OLD.timesheet_id, OLD.claim_id, OLD.created_at, OLD.created_by, OLD.deleted_at)
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
