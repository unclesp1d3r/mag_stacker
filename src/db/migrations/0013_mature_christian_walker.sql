ALTER TABLE "accessory" ADD CONSTRAINT "accessory_installed_date_requires_mount" CHECK ("accessory"."installed_date" IS NULL OR "accessory"."current_firearm_id" IS NOT NULL);
