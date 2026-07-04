CREATE TABLE "magazine_label_prefix" (
	"owner_id" text NOT NULL,
	"prefix" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "magazine_label_prefix_owner_id_prefix_pk" PRIMARY KEY("owner_id","prefix")
);
--> statement-breakpoint
ALTER TABLE "magazine_label_prefix" ADD CONSTRAINT "magazine_label_prefix_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
