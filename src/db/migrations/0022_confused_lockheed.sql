CREATE TABLE "accessory_attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"accessory_id" uuid NOT NULL,
	"type" text NOT NULL,
	"spec" text DEFAULT '' NOT NULL,
	"serial_number" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "accessory_attachment_type_valid" CHECK ("accessory_attachment"."type" in ('mount', 'piston', 'end cap', 'muzzle device', 'other'))
);
--> statement-breakpoint
CREATE TABLE "accessory_firearm" (
	"accessory_id" uuid NOT NULL,
	"firearm_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	CONSTRAINT "accessory_firearm_accessory_id_firearm_id_pk" PRIMARY KEY("accessory_id","firearm_id")
);
--> statement-breakpoint
ALTER TABLE "grant" DROP CONSTRAINT "grant_parent_type_valid";--> statement-breakpoint
ALTER TABLE "accessory" ALTER COLUMN "category" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "accessory" ADD COLUMN "type" text DEFAULT 'other' NOT NULL;--> statement-breakpoint
--- HAND-EDITED (#23 R2): backfill `type` from the shipped free-text `category`.
--- The ADD COLUMN above already filled every existing row with the 'other'
--- default, so this only has to CORRECT the rows whose category names a real
--- controlled type. Matching is case-insensitive and whitespace-tolerant
--- because `category` was free text for #8's whole lifetime ("Optic",
--- " suppressor" and "suppressor" are all the same classification).
---
--- `category` is deliberately NOT modified: an unmapped value like "bipod"
--- keeps its category verbatim and simply lands on type='other' (AE6). That
--- makes this backfill lossless and reversible — no owner-entered string is
--- destroyed, so a later, better mapping can still be applied.
---
--- The value list mirrors ACCESSORY_TYPES in
--- src/domain/accessories/constants.ts. SQL cannot import the TS constant, so
--- this is a deliberate copy.
---
--- Know exactly what the accessory_type_valid CHECK below does and does not
--- protect: it validates SET MEMBERSHIP, not MAPPING CORRECTNESS, and its
--- value list is hand-copied from the same constant this WHERE clause is, so
--- it is not an independent check.
---   * A value that drifts OUT of the set  -> CHECK fails, whole migration
---     aborts, nothing commits. Fail-safe.
---   * A value mapped to the WRONG member of the set (e.g. classifying laser
---     rows as 'light') -> CHECK passes and the migration commits silently
---     wrong data.
--- Nothing here self-verifies the mapping. Diff the pre- and post-migration
--- `SELECT lower(trim(category)), count(*) FROM accessory GROUP BY 1` to
--- confirm it landed as intended. Recovery is a forward fix, not a rollback:
--- `category` is preserved verbatim (below), so the source data survives.
UPDATE "accessory"
   SET "type" = lower(trim("category"))
 WHERE lower(trim("category")) IN ('suppressor', 'optic', 'light', 'laser', 'muzzle device');--> statement-breakpoint
ALTER TABLE "accessory_attachment" ADD CONSTRAINT "accessory_attachment_accessory_id_accessory_id_fk" FOREIGN KEY ("accessory_id") REFERENCES "public"."accessory"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accessory_firearm" ADD CONSTRAINT "accessory_firearm_accessory_id_accessory_id_fk" FOREIGN KEY ("accessory_id") REFERENCES "public"."accessory"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accessory_firearm" ADD CONSTRAINT "accessory_firearm_firearm_id_firearm_id_fk" FOREIGN KEY ("firearm_id") REFERENCES "public"."firearm"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accessory_attachment_accessory_id_idx" ON "accessory_attachment" USING btree ("accessory_id");--> statement-breakpoint
CREATE INDEX "accessory_firearm_firearm_id_idx" ON "accessory_firearm" USING btree ("firearm_id");--> statement-breakpoint
ALTER TABLE "accessory" ADD CONSTRAINT "accessory_type_valid" CHECK ("accessory"."type" in ('suppressor', 'optic', 'light', 'laser', 'muzzle device', 'other'));--> statement-breakpoint
ALTER TABLE "grant" ADD CONSTRAINT "grant_parent_type_valid" CHECK ("grant"."parent_type" in ('firearm', 'magazine', 'ammo', 'accessory'));--> statement-breakpoint
--- HAND-EDITED (#23 R10, KTD4): grant cleanup for the newly-grantable
--- `accessory` parent family. `delete_grants_for_parent()` is already
--- parameterized by TG_ARGV[0] (migration 0002), so this needs no new
--- function — it is the same one-line addition ammo got in 0010.
---
--- Required because `grant.parent_id` is polymorphic and therefore cannot
--- carry a foreign key: without this trigger, deleting an accessory would
--- leave its grant rows dangling, and a later accessory allocated the same
--- uuid would silently inherit them.
CREATE TRIGGER accessory_grants_cleanup
  BEFORE DELETE ON "accessory"
  FOR EACH ROW
  EXECUTE FUNCTION delete_grants_for_parent('accessory');
