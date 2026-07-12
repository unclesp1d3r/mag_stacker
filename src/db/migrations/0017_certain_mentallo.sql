CREATE TABLE "firearm_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firearm_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"doc_type" text DEFAULT 'other' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "firearm_document_mime_type_valid" CHECK ("firearm_document"."mime_type" in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/avif')),
	CONSTRAINT "firearm_document_doc_type_valid" CHECK ("firearm_document"."doc_type" in ('receipt', 'warranty', 'atf-form-1', 'atf-form-4', 'manual', 'insurance', 'other')),
	CONSTRAINT "firearm_document_size_bytes_min" CHECK ("firearm_document"."size_bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "firearm_document" ADD CONSTRAINT "firearm_document_firearm_id_firearm_id_fk" FOREIGN KEY ("firearm_id") REFERENCES "public"."firearm"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "firearm_document_firearm_id_idx" ON "firearm_document" USING btree ("firearm_id");
