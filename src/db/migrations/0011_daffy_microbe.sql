CREATE TABLE "accessory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"current_firearm_id" uuid,
	"category" text NOT NULL,
	"brand" text DEFAULT '' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"serial_number" text DEFAULT '' NOT NULL,
	"installed_date" date,
	"cost_cents" integer,
	"notes" text DEFAULT '' NOT NULL,
	"is_nfa" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "accessory_cost_cents_min" CHECK ("accessory"."cost_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "firearm" ADD COLUMN "is_nfa" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "accessory" ADD CONSTRAINT "accessory_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accessory" ADD CONSTRAINT "accessory_current_firearm_id_firearm_id_fk" FOREIGN KEY ("current_firearm_id") REFERENCES "public"."firearm"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accessory_owner_id_idx" ON "accessory" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "accessory_current_firearm_id_idx" ON "accessory" USING btree ("current_firearm_id");
