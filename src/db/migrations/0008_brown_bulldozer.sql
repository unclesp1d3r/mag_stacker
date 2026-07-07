CREATE TABLE "inventory_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_type" text NOT NULL,
	"parent_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_log_parent_type_valid" CHECK ("inventory_log"."parent_type" in ('firearm', 'magazine')),
	CONSTRAINT "inventory_log_event_type_valid" CHECK (("inventory_log"."parent_type" = 'firearm' AND "inventory_log"."event_type" in ('inventoried', 'cleaned', 'lubed')) OR ("inventory_log"."parent_type" = 'magazine' AND "inventory_log"."event_type" in ('inventoried')))
);
--> statement-breakpoint
ALTER TABLE "inventory_log" ADD CONSTRAINT "inventory_log_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_log_parent_idx" ON "inventory_log" USING btree ("parent_type","parent_id","occurred_at");
--> statement-breakpoint

-- Backstop for R13: when an owned parent is deleted, remove its inventory_log
-- rows. The polymorphic `inventory_log.parent_id` cannot carry a foreign key,
-- so the authoritative cleanup runs in the same transaction as the delete
-- (U4-equivalent for this child). This trigger guarantees log rows never
-- dangle even if a parent is deleted outside that path (e.g. an owner-cascade
-- when a user is removed, or a manual delete). Mirrors
-- 0002_grant_cleanup_triggers.sql.

CREATE OR REPLACE FUNCTION delete_inventory_log_for_parent() RETURNS trigger AS $$
BEGIN
  DELETE FROM "inventory_log"
   WHERE parent_type = TG_ARGV[0]
     AND parent_id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER firearm_inventory_log_cleanup
  BEFORE DELETE ON "firearm"
  FOR EACH ROW
  EXECUTE FUNCTION delete_inventory_log_for_parent('firearm');
--> statement-breakpoint
CREATE TRIGGER magazine_inventory_log_cleanup
  BEFORE DELETE ON "magazine"
  FOR EACH ROW
  EXECUTE FUNCTION delete_inventory_log_for_parent('magazine');
