-- User prompts and suggested intent prompts share a 150-character limit.
UPDATE "users"
SET "intent" = LEFT("intent", 150)
WHERE "intent" IS NOT NULL AND char_length("intent") > 150;

ALTER TABLE "users" ALTER COLUMN "intent" TYPE VARCHAR(150);

ALTER TABLE "intent_prompts" ALTER COLUMN "text" TYPE VARCHAR(150);
