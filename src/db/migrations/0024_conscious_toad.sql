ALTER TABLE "inventory_log" DROP CONSTRAINT "inventory_log_parent_type_valid";--> statement-breakpoint
ALTER TABLE "inventory_log" DROP CONSTRAINT "inventory_log_event_type_valid";--> statement-breakpoint
ALTER TABLE "inventory_log" ADD COLUMN "counted_rounds" integer;--> statement-breakpoint
ALTER TABLE "inventory_log" ADD COLUMN "recorded_rounds" integer;--> statement-breakpoint
ALTER TABLE "inventory_log" ADD CONSTRAINT "inventory_log_counts_by_family" CHECK (("inventory_log"."parent_type" = 'ammo' AND "inventory_log"."counted_rounds" IS NOT NULL AND "inventory_log"."counted_rounds" >= 0 AND "inventory_log"."recorded_rounds" IS NOT NULL AND "inventory_log"."recorded_rounds" >= 0) OR ("inventory_log"."parent_type" <> 'ammo' AND "inventory_log"."counted_rounds" IS NULL AND "inventory_log"."recorded_rounds" IS NULL));--> statement-breakpoint
ALTER TABLE "inventory_log" ADD CONSTRAINT "inventory_log_parent_type_valid" CHECK ("inventory_log"."parent_type" in ('firearm', 'magazine', 'ammo'));--> statement-breakpoint
ALTER TABLE "inventory_log" ADD CONSTRAINT "inventory_log_event_type_valid" CHECK (("inventory_log"."parent_type" = 'firearm' AND "inventory_log"."event_type" in ('inventoried')) OR ("inventory_log"."parent_type" = 'magazine' AND "inventory_log"."event_type" in ('inventoried')) OR ("inventory_log"."parent_type" = 'ammo' AND "inventory_log"."event_type" in ('inventoried')));--> statement-breakpoint

-- #100 (ammo reconciliation, KTD8): ammo is now an inventory_log parent, so
-- its rows need the same parent-delete cleanup firearm and magazine got in
-- 0008_brown_bulldozer.sql. The polymorphic `inventory_log.parent_id` cannot
-- carry a foreign key, so cleanup rides on a BEFORE DELETE trigger wired to the
-- existing, TG_ARGV-parameterized `delete_inventory_log_for_parent()` function
-- — the function itself is unchanged.
CREATE TRIGGER ammo_inventory_log_cleanup
  BEFORE DELETE ON "ammo"
  FOR EACH ROW
  EXECUTE FUNCTION delete_inventory_log_for_parent('ammo');
