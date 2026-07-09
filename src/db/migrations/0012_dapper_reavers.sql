CREATE TABLE "range_session_accessory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"range_session_id" uuid NOT NULL,
	"accessory_id" uuid,
	CONSTRAINT "range_session_accessory_unique" UNIQUE("range_session_id","accessory_id")
);
--> statement-breakpoint
ALTER TABLE "range_session_accessory" ADD CONSTRAINT "range_session_accessory_range_session_id_range_session_id_fk" FOREIGN KEY ("range_session_id") REFERENCES "public"."range_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "range_session_accessory" ADD CONSTRAINT "range_session_accessory_accessory_id_accessory_id_fk" FOREIGN KEY ("accessory_id") REFERENCES "public"."accessory"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "range_session_accessory_session_id_idx" ON "range_session_accessory" USING btree ("range_session_id");--> statement-breakpoint
CREATE INDEX "range_session_accessory_accessory_id_idx" ON "range_session_accessory" USING btree ("accessory_id");
