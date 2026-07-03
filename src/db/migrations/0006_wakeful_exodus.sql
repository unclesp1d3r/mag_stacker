CREATE TABLE "range_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firearm_id" uuid NOT NULL,
	"date" date NOT NULL,
	"rounds_fired" integer NOT NULL,
	"ammo_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "range_session_rounds_fired_min" CHECK ("range_session"."rounds_fired" >= 1)
);
--> statement-breakpoint
ALTER TABLE "range_session" ADD CONSTRAINT "range_session_firearm_id_firearm_id_fk" FOREIGN KEY ("firearm_id") REFERENCES "public"."firearm"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "range_session_firearm_id_idx" ON "range_session" USING btree ("firearm_id");
