CREATE UNIQUE INDEX "firearm_photo_one_primary_per_firearm" ON "firearm_photo" USING btree ("firearm_id") WHERE "firearm_photo"."is_primary";
