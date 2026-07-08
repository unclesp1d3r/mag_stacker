CREATE TABLE "ammo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"brand" text DEFAULT '' NOT NULL,
	"caliber" text NOT NULL,
	"type" text DEFAULT '' NOT NULL,
	"grain" integer DEFAULT 0 NOT NULL,
	"quantity_rounds" integer DEFAULT 0 NOT NULL,
	"low_stock_threshold" integer DEFAULT 0 NOT NULL,
	"acquired_date" date,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ammo_grain_min" CHECK ("ammo"."grain" >= 0),
	CONSTRAINT "ammo_quantity_min" CHECK ("ammo"."quantity_rounds" >= 0),
	CONSTRAINT "ammo_threshold_min" CHECK ("ammo"."low_stock_threshold" >= 0)
);
--> statement-breakpoint
ALTER TABLE "grant" DROP CONSTRAINT "grant_parent_type_valid";--> statement-breakpoint
ALTER TABLE "ammo" ADD CONSTRAINT "ammo_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ammo_owner_id_idx" ON "ammo" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE "grant" ADD CONSTRAINT "grant_parent_type_valid" CHECK ("grant"."parent_type" in ('firearm', 'magazine', 'ammo'));
--> statement-breakpoint

-- Hand-added (not emitted by drizzle-kit): extend the R17b grant-cleanup
-- backstop from migration 0002 to the new `ammo` parent. `delete_grants_for_parent()`
-- already exists; ammo just needs its own BEFORE DELETE trigger wired to it,
-- mirroring `firearm_grants_cleanup` / `magazine_grants_cleanup`.
CREATE TRIGGER ammo_grants_cleanup
  BEFORE DELETE ON "ammo"
  FOR EACH ROW
  EXECUTE FUNCTION delete_grants_for_parent('ammo');
