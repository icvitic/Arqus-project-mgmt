ALTER TABLE "expenses" ADD COLUMN "recognised_cents" bigint;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "decision_reason" text;--> statement-breakpoint
ALTER TABLE "reimbursement_claims" ADD COLUMN "early_reason" text;--> statement-breakpoint
ALTER TABLE "reimbursement_claims" ADD COLUMN "submission" jsonb;--> statement-breakpoint
ALTER TABLE "reimbursement_claims" ADD COLUMN "decision_date" date;--> statement-breakpoint
ALTER TABLE "reimbursement_claims" ADD COLUMN "decision" jsonb;--> statement-breakpoint
ALTER TABLE "reimbursement_claims" ADD COLUMN "payment_note" text;--> statement-breakpoint
-- WP1.16a: postojeći zapisi ostaju valjani. Prije odluke po trošku prihvaćeni trošak bio je priznat u cijelosti, odbijen s 0.
-- Okidač nepromjenjivosti (0009) privremeno se isključuje samo za ovu jednokratnu dopunu (migracija ide kao vlasnik).
ALTER TABLE "expenses" DISABLE TRIGGER "expenses_immutable_trg";--> statement-breakpoint
UPDATE "expenses" SET "recognised_cents" = "amount_cents" WHERE "status" = 'accepted';--> statement-breakpoint
UPDATE "expenses" SET "recognised_cents" = 0 WHERE "status" = 'rejected';--> statement-breakpoint
ALTER TABLE "expenses" ENABLE TRIGGER "expenses_immutable_trg";--> statement-breakpoint
-- Odlučeni zahtjevi: datum odluke iz vremena unosa; odobreni iznos zadržava se kao iznos financijera.
UPDATE "reimbursement_claims" SET "decision_date" = ("decided_at" AT TIME ZONE 'Europe/Zagreb')::date,
  "decision" = jsonb_build_object('backfilled', true, 'funderTotal', "approved_cents")
  WHERE "status" IN ('approved', 'partially_approved', 'rejected') AND "decided_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_decision_ck" CHECK ((status in ('accepted', 'partially_accepted', 'rejected')) = (recognised_cents is not null)
    and (recognised_cents is null or recognised_cents between 0 and amount_cents)
    and (status <> 'accepted' or recognised_cents = amount_cents)
    and (status <> 'rejected' or recognised_cents = 0)
    and (status <> 'partially_accepted' or (recognised_cents > 0 and recognised_cents < amount_cents)));