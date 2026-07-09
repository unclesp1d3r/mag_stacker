ALTER TABLE "inventory_log" DROP CONSTRAINT "inventory_log_actor_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "inventory_log" ALTER COLUMN "actor_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_log" ADD CONSTRAINT "inventory_log_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
