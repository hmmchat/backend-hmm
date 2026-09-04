#!/usr/bin/env bash
# Create deploy/dozzle/data/users.yml for Dozzle simple auth.
# Password is prompted on stdin and is not stored in the command line.
#
# Usage (from repo root):
#   bash scripts/dozzle-generate-user.sh
#   bash scripts/dozzle-generate-user.sh admin ops@beam.place "Beam Ops"
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="$ROOT/deploy/dozzle/data"
OUT="$DATA_DIR/users.yml"
IMAGE="amir20/dozzle:v10.8.0"

USERNAME="${1:-admin}"
EMAIL="${2:-ops@localhost}"
NAME="${3:-Admin}"

mkdir -p "$DATA_DIR"

if [[ -f "$OUT" ]]; then
  echo "Refusing to overwrite $OUT (move it aside if you want a new file)." >&2
  exit 1
fi

echo "Creating Dozzle user '$USERNAME' (roles: none = view logs only)."
echo "Enter a password when prompted. It will not appear in shell history."

docker run -it --rm "$IMAGE" generate "$USERNAME" \
  --email "$EMAIL" \
  --name "$NAME" \
  --user-roles none > "$OUT"

chmod 600 "$OUT"
echo "Wrote $OUT"
echo "Start Dozzle with: docker compose up -d dozzle"
