ALTER TABLE "firearm" ADD COLUMN "type" text DEFAULT 'unspecified' NOT NULL;--> statement-breakpoint
ALTER TABLE "firearm" ADD COLUMN "action" text DEFAULT 'unspecified' NOT NULL;--> statement-breakpoint
ALTER TABLE "firearm" ADD COLUMN "subtype" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "firearm" ADD CONSTRAINT "firearm_type_valid" CHECK ("firearm"."type" in ('pistol', 'revolver', 'rifle', 'shotgun', 'pcc', 'other', 'unspecified'));--> statement-breakpoint
ALTER TABLE "firearm" ADD CONSTRAINT "firearm_action_valid" CHECK ("firearm"."action" in ('semi-auto', 'bolt', 'lever', 'pump', 'break', 'single-shot', 'unspecified'));
