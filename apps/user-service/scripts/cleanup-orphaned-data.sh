#!/bin/bash
# Cleanup orphaned data in junction tables before seeding
# This prevents unique constraint violations when reseeding

set -e

PGPASSWORD=password psql -h localhost -U postgres -d hmm_user <<EOF
-- Clean up orphaned junction table data
DELETE FROM user_interests WHERE "userId" NOT IN (SELECT id FROM users);
DELETE FROM user_values WHERE "userId" NOT IN (SELECT id FROM users);
DELETE FROM user_brands WHERE "userId" NOT IN (SELECT id FROM users);
DELETE FROM user_photos WHERE "userId" NOT IN (SELECT id FROM users);

-- Show what was cleaned
SELECT 'Cleaned orphaned data' AS status;
EOF

echo "✅ Cleanup completed"

