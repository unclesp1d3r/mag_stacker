CREATE TABLE "operator_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"outcome" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operator_audit_action_valid" CHECK ("operator_audit"."action" in ('export', 'restore'))
);
--> statement-breakpoint
CREATE INDEX "operator_audit_at_idx" ON "operator_audit" USING btree ("at");
