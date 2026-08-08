-- Align users.intent with Prisma schema / API / UI (was VARCHAR(50) from init).
ALTER TABLE "users" ALTER COLUMN "intent" TYPE VARCHAR(255);
