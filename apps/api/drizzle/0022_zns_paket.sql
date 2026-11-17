ALTER TABLE "reimbursement_claims" ADD COLUMN "earlier_expense_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "reimbursement_claims" ADD COLUMN "preparation_minutes" integer;--> statement-breakpoint
ALTER TABLE "reimbursement_claims" ADD CONSTRAINT "reimbursement_claims_preparation_ck" CHECK (preparation_minutes is null or preparation_minutes between 0 and 600000);