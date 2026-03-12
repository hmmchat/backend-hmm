-- Intent prompts catalog: suggested profile intents users can pick from

CREATE TABLE IF NOT EXISTS "intent_prompts" (
  "id" TEXT PRIMARY KEY,
  "text" VARCHAR(100) NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "order" INTEGER,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "intent_prompts_is_active_idx"
ON "intent_prompts"("isActive");

