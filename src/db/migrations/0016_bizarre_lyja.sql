ALTER TABLE "firearm_photo" ADD CONSTRAINT "firearm_photo_mime_type_valid" CHECK ("firearm_photo"."mime_type" in ('image/jpeg', 'image/png', 'image/webp', 'image/avif'));--> statement-breakpoint
ALTER TABLE "firearm_photo" ADD CONSTRAINT "firearm_photo_size_bytes_min" CHECK ("firearm_photo"."size_bytes" > 0);--> statement-breakpoint
ALTER TABLE "firearm_photo" ADD CONSTRAINT "firearm_photo_width_min" CHECK ("firearm_photo"."width" > 0);--> statement-breakpoint
ALTER TABLE "firearm_photo" ADD CONSTRAINT "firearm_photo_height_min" CHECK ("firearm_photo"."height" > 0);
