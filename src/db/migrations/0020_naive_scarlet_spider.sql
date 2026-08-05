-- U5 (service-intervals plan): retiring `cleaned`/`lubed` as firearm
-- inventory-log event types (R13) and converting every existing entry into a
-- `service_event` on a seeded Cleaning/Lubrication rule (R15; KTD1, KTD7 — no
-- `service_rule` row is seeded, only events). This is the one irreversible,
-- destructive step in the whole plan (see the plan's Risks section): rows
-- are deleted after conversion and there is no down-migration.
--
-- Row-count reconciliation runs inside this DO block: the count of firearm
-- `cleaned`/`lubed` rows read must equal the count of `service_event` rows
-- inserted, and must equal the count of `inventory_log` rows deleted. Any
-- mismatch raises via RAISE EXCEPTION, which aborts and rolls back the whole
-- migration transaction (drizzle-orm runs all pending migrations in one
-- `session.transaction`) rather than silently losing or duplicating history.
--
-- Ordering matters and must not be reordered: (1) insert the converted
-- service events, (2) delete the converted inventory_log rows, (3) replace
-- `inventory_log_event_type_valid` with the narrowed firearm list. Replacing
-- the CHECK before the delete would reject the table's own historical
-- `cleaned`/`lubed` rows and fail the migration before conversion ever runs.
--
-- Operational assumption: this reconciliation only holds if no other writer
-- inserts firearm `cleaned`/`lubed` inventory_log rows during the migration
-- window. drizzle-orm wraps every pending migration in one transaction, so a
-- mismatch here aborts the whole batch, not just this file.
DO $$
DECLARE
  read_count integer;
  inserted_count integer;
  deleted_count integer;
BEGIN
  SELECT count(*) INTO read_count
    FROM "inventory_log"
   WHERE "parent_type" = 'firearm'
     AND "event_type" IN ('cleaned', 'lubed');

  INSERT INTO "service_event"
    ("firearm_id", "rule_name", "serviced_on", "actor_id", "notes", "created_at")
  SELECT
    "parent_id",
    CASE "event_type"
      WHEN 'cleaned' THEN 'Cleaning'
      WHEN 'lubed' THEN 'Lubrication'
    END,
    "occurred_at"::date,
    "actor_id",
    "notes",
    "created_at"
  FROM "inventory_log"
  WHERE "parent_type" = 'firearm'
    AND "event_type" IN ('cleaned', 'lubed');

  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  IF inserted_count <> read_count THEN
    RAISE EXCEPTION
      'U5 service-event conversion mismatch: read % firearm cleaned/lubed inventory_log rows but inserted % service_event rows',
      read_count, inserted_count;
  END IF;

  DELETE FROM "inventory_log"
   WHERE "parent_type" = 'firearm'
     AND "event_type" IN ('cleaned', 'lubed');

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  IF deleted_count <> read_count THEN
    RAISE EXCEPTION
      'U5 service-event conversion mismatch: read % firearm cleaned/lubed inventory_log rows but deleted % rows',
      read_count, deleted_count;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "inventory_log" DROP CONSTRAINT "inventory_log_event_type_valid";--> statement-breakpoint
ALTER TABLE "inventory_log" ADD CONSTRAINT "inventory_log_event_type_valid" CHECK (("inventory_log"."parent_type" = 'firearm' AND "inventory_log"."event_type" in ('inventoried')) OR ("inventory_log"."parent_type" = 'magazine' AND "inventory_log"."event_type" in ('inventoried')));
