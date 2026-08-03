CREATE TABLE "service_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firearm_id" uuid,
	"accessory_id" uuid,
	"rule_name" text NOT NULL,
	"serviced_on" date NOT NULL,
	"actor_id" text,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "service_event_exactly_one_parent" CHECK (num_nonnulls("service_event"."firearm_id", "service_event"."accessory_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "service_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firearm_id" uuid,
	"accessory_id" uuid,
	"name" text NOT NULL,
	"suppressed" boolean DEFAULT false NOT NULL,
	"interval_days" integer,
	"interval_sessions" integer,
	"interval_rounds" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "service_rule_firearm_name_unique" UNIQUE("firearm_id","name"),
	CONSTRAINT "service_rule_accessory_name_unique" UNIQUE("accessory_id","name"),
	CONSTRAINT "service_rule_exactly_one_parent" CHECK (num_nonnulls("service_rule"."firearm_id", "service_rule"."accessory_id") = 1),
	CONSTRAINT "service_rule_thresholds_min" CHECK (("service_rule"."interval_days" IS NULL OR "service_rule"."interval_days" >= 1) AND ("service_rule"."interval_sessions" IS NULL OR "service_rule"."interval_sessions" >= 1) AND ("service_rule"."interval_rounds" IS NULL OR "service_rule"."interval_rounds" >= 1)),
	CONSTRAINT "service_rule_suppressed_thresholds_consistent" CHECK (("service_rule"."suppressed" AND num_nonnulls("service_rule"."interval_days", "service_rule"."interval_sessions", "service_rule"."interval_rounds") = 0) OR (NOT "service_rule"."suppressed" AND num_nonnulls("service_rule"."interval_days", "service_rule"."interval_sessions", "service_rule"."interval_rounds") >= 1))
);
--> statement-breakpoint
CREATE TABLE "service_rule_default" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"scope" text NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"interval_days" integer,
	"interval_sessions" integer,
	"interval_rounds" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "service_rule_default_owner_scope_category_name_unique" UNIQUE("owner_id","scope","category","name"),
	CONSTRAINT "service_rule_default_scope_valid" CHECK ("service_rule_default"."scope" in ('firearm', 'accessory')),
	CONSTRAINT "service_rule_default_has_threshold" CHECK (num_nonnulls("service_rule_default"."interval_days", "service_rule_default"."interval_sessions", "service_rule_default"."interval_rounds") >= 1),
	CONSTRAINT "service_rule_default_thresholds_min" CHECK (("service_rule_default"."interval_days" IS NULL OR "service_rule_default"."interval_days" >= 1) AND ("service_rule_default"."interval_sessions" IS NULL OR "service_rule_default"."interval_sessions" >= 1) AND ("service_rule_default"."interval_rounds" IS NULL OR "service_rule_default"."interval_rounds" >= 1))
);
--> statement-breakpoint
ALTER TABLE "firearm" ADD COLUMN "acquired_date" date;--> statement-breakpoint
ALTER TABLE "service_event" ADD CONSTRAINT "service_event_firearm_id_firearm_id_fk" FOREIGN KEY ("firearm_id") REFERENCES "public"."firearm"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_event" ADD CONSTRAINT "service_event_accessory_id_accessory_id_fk" FOREIGN KEY ("accessory_id") REFERENCES "public"."accessory"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_event" ADD CONSTRAINT "service_event_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_rule" ADD CONSTRAINT "service_rule_firearm_id_firearm_id_fk" FOREIGN KEY ("firearm_id") REFERENCES "public"."firearm"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_rule" ADD CONSTRAINT "service_rule_accessory_id_accessory_id_fk" FOREIGN KEY ("accessory_id") REFERENCES "public"."accessory"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_rule_default" ADD CONSTRAINT "service_rule_default_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_event_firearm_id_idx" ON "service_event" USING btree ("firearm_id");--> statement-breakpoint
CREATE INDEX "service_event_accessory_id_idx" ON "service_event" USING btree ("accessory_id");--> statement-breakpoint
CREATE INDEX "service_event_firearm_rule_serviced_idx" ON "service_event" USING btree ("firearm_id","rule_name","serviced_on");--> statement-breakpoint
CREATE INDEX "service_event_accessory_rule_serviced_idx" ON "service_event" USING btree ("accessory_id","rule_name","serviced_on");--> statement-breakpoint
CREATE INDEX "service_rule_firearm_id_idx" ON "service_rule" USING btree ("firearm_id");--> statement-breakpoint
CREATE INDEX "service_rule_accessory_id_idx" ON "service_rule" USING btree ("accessory_id");--> statement-breakpoint
CREATE INDEX "service_rule_default_owner_id_idx" ON "service_rule_default" USING btree ("owner_id");
