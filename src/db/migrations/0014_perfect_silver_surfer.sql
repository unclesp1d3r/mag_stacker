CREATE TABLE "firearm_photo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firearm_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"sort_order" integer NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "firearm_photo_sort_order_min" CHECK ("firearm_photo"."sort_order" >= 0)
);
--> statement-breakpoint
ALTER TABLE "firearm_photo" ADD CONSTRAINT "firearm_photo_firearm_id_firearm_id_fk" FOREIGN KEY ("firearm_id") REFERENCES "public"."firearm"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "firearm_photo_firearm_id_idx" ON "firearm_photo" USING btree ("firearm_id");
