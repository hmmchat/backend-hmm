-- Display names (username) are not unique; uniqueness is via user id.
-- Init migration created users_username_key; schema already uses a non-unique index.
DROP INDEX IF EXISTS "users_username_key";
CREATE INDEX IF NOT EXISTS "users_username_idx" ON "users"("username");
