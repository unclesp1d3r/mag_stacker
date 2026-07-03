CREATE TABLE "firearm" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"manufacturer" text DEFAULT '' NOT NULL,
	"caliber" text NOT NULL,
	"serial_number" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"grantee_id" text NOT NULL,
	"parent_type" text NOT NULL,
	"parent_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"allow_create_on_behalf" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "grant_grantee_parent_unique" UNIQUE("grantee_id","parent_type","parent_id"),
	CONSTRAINT "grant_parent_type_valid" CHECK ("grant"."parent_type" in ('firearm', 'magazine')),
	CONSTRAINT "grant_permission_valid" CHECK ("grant"."permission" in ('view', 'edit'))
);
--> statement-breakpoint
CREATE TABLE "idempotency" (
	"user_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"result" jsonb,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_user_id_idempotency_key_pk" PRIMARY KEY("user_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "magazine" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"brand_model" text NOT NULL,
	"caliber" text NOT NULL,
	"base_capacity" integer NOT NULL,
	"extension_rounds" integer DEFAULT 0 NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"acquired_date" date,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "magazine_base_capacity_min" CHECK ("magazine"."base_capacity" >= 1),
	CONSTRAINT "magazine_extension_rounds_min" CHECK ("magazine"."extension_rounds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "magazine_firearm" (
	"magazine_id" uuid NOT NULL,
	"firearm_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	CONSTRAINT "magazine_firearm_magazine_id_firearm_id_pk" PRIMARY KEY("magazine_id","firearm_id")
);
--> statement-breakpoint
ALTER TABLE "firearm" ADD CONSTRAINT "firearm_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grant" ADD CONSTRAINT "grant_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grant" ADD CONSTRAINT "grant_grantee_id_user_id_fk" FOREIGN KEY ("grantee_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency" ADD CONSTRAINT "idempotency_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "magazine" ADD CONSTRAINT "magazine_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "magazine_firearm" ADD CONSTRAINT "magazine_firearm_magazine_id_magazine_id_fk" FOREIGN KEY ("magazine_id") REFERENCES "public"."magazine"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "magazine_firearm" ADD CONSTRAINT "magazine_firearm_firearm_id_firearm_id_fk" FOREIGN KEY ("firearm_id") REFERENCES "public"."firearm"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "firearm_owner_id_idx" ON "firearm" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "grant_grantee_parent_type_idx" ON "grant" USING btree ("grantee_id","parent_type");--> statement-breakpoint
CREATE INDEX "idempotency_expires_at_idx" ON "idempotency" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "magazine_owner_id_idx" ON "magazine" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "magazine_firearm_firearm_id_idx" ON "magazine_firearm" USING btree ("firearm_id");
