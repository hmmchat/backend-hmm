-- Add missing UserStatus enum values
-- The init migration created UserStatus with old values (IDLE, IN_MATCHMAKING, etc.)
-- But the schema now uses: AVAILABLE, ONLINE, OFFLINE, IN_SQUAD_AVAILABLE, IN_BROADCAST_AVAILABLE
-- This migration adds the missing values to support the current schema

-- Add AVAILABLE status (primary status for discovery flow)
ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'AVAILABLE';

-- Add ONLINE status (for homepage offline cards)
ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'ONLINE';

-- Add OFFLINE status (for homepage offline cards)
ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'OFFLINE';

-- Add IN_SQUAD_AVAILABLE status (user in squad but available for new matches)
ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'IN_SQUAD_AVAILABLE';

-- Add IN_BROADCAST_AVAILABLE status (user in broadcast but available for new matches)
ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'IN_BROADCAST_AVAILABLE';

-- Note: Old enum values (IDLE, IN_MATCHMAKING, IN_ONE_ON_ONE_CALL, WATCHING_HMM_TV) remain in the enum
-- but are not used in the current schema. They can be safely ignored or removed in a future migration
-- if needed. PostgreSQL doesn't easily support removing enum values, so we leave them for now.
