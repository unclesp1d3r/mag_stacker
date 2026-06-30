-- Custom SQL migration file, put your code below! --

-- Backstop for R17b: when an owned parent is deleted, remove its grant rows.
-- The polymorphic `grant.parent_id` cannot carry a foreign key, so the
-- authoritative cleanup runs in the same transaction as the delete (U4). This
-- trigger guarantees grants never dangle even if a parent is deleted outside
-- that path (e.g. an owner-cascade when a user is removed, or a manual delete).

CREATE OR REPLACE FUNCTION delete_grants_for_parent() RETURNS trigger AS $$
BEGIN
  DELETE FROM "grant"
   WHERE parent_type = TG_ARGV[0]
     AND parent_id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER firearm_grants_cleanup
  BEFORE DELETE ON "firearm"
  FOR EACH ROW
  EXECUTE FUNCTION delete_grants_for_parent('firearm');
--> statement-breakpoint
CREATE TRIGGER magazine_grants_cleanup
  BEFORE DELETE ON "magazine"
  FOR EACH ROW
  EXECUTE FUNCTION delete_grants_for_parent('magazine');