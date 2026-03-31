#!/bin/bash
set -euo pipefail

LOCK_FILE="/tmp/skillLib-test.lock"

cleanup() { rm -f "$LOCK_FILE"; }

if [ -f "$LOCK_FILE" ]; then
  echo "Tests already running"
  exit 1
fi

touch "$LOCK_FILE"
trap cleanup EXIT

# .env.buntest must exist in the current working directory
NEXT_DIR="$(pwd)"
if [ ! -f "$NEXT_DIR/.env.buntest" ]; then
  echo "Error: Could not find .env.buntest in current directory: $NEXT_DIR"
  exit 1
fi

set -a
source .env.buntest
set +a

# Run Prisma migrations if needed
if [ -f "schema.prisma" ] || [ -f "prisma/schema.prisma" ] || [ -f "prisma.config.ts" ]; then
  npx prisma migrate deploy > /dev/null 2>&1
  npx prisma generate
fi

if [ $# -eq 0 ]; then
  bun test --randomize
else
  bun test "$@"
fi
