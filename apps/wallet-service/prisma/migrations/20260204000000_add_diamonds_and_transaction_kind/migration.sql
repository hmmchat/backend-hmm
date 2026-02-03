-- Add diamonds column to wallets (separate from coins)
-- Safe when wallets table does not exist yet (no-op)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'wallets') THEN
    ALTER TABLE "wallets" ADD COLUMN IF NOT EXISTS "diamonds" INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;

-- Create enum type for transaction kind (ignore if already exists)
DO $$ BEGIN
  CREATE TYPE "TransactionKind" AS ENUM ('COINS', 'DIAMONDS', 'CONVERSION');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Add optional diamond audit fields to transactions (safe when table does not exist)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'transactions') THEN
    ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "diamondAmount" INTEGER;
    ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "transactionKind" "TransactionKind";
  END IF;
END $$;
