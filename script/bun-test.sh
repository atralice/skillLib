#!/bin/bash
set -euo pipefail

# .env.buntest must exist in the current working directory
NEXT_DIR="$(pwd)"
if [ ! -f "$NEXT_DIR/.env.buntest" ]; then
  echo "Error: Could not find .env.buntest in current directory: $NEXT_DIR"
  exit 1
fi

# Check if Prisma is needed by looking for schema files or config
needs_prisma() {
  [ -f "$NEXT_DIR/schema.prisma" ] || [ -f "$NEXT_DIR/prisma/schema.prisma" ] || [ -f "$NEXT_DIR/prisma.config.ts" ]
}

run_prisma_if_needed() {
  if needs_prisma; then
    npx prisma migrate deploy > /dev/null 2>&1
    npx prisma generate
  fi
}

if [ -n "${CI:-}" ]; then
  # If running in CI, retain existing environment variables and load .env.buntest.
  cd "$NEXT_DIR"
  set -a
  source .env.buntest
  set +a

  # In CI, keep the configured DATABASE_URL database name.
  if [ -n "${DATABASE_URL:-}" ]; then
    baseDbName="${DATABASE_URL##*/}"

    # Safety check: only allow test databases
    if [[ ! "$baseDbName" =~ test ]]; then
      echo "Error: DATABASE_URL must contain 'test' in database name for safety"
      exit 1
    fi
  fi

  # Run migrations on the configured CI test database
  run_prisma_if_needed
  bun test "$@"
else
  # If running locally, clear all environment variables before loading .env.buntest.
  env -i PATH="$PATH" HOME="$HOME" DEBUG="${DEBUG:-}" NEXT_DIR="$NEXT_DIR" bash -c '
    set -o allexport
    source "$NEXT_DIR/.env.buntest"
    set +o allexport
    cd "$NEXT_DIR"

    # Setup dynamic test database
    if [ -n "${DATABASE_URL:-}" ]; then
      # Parse DATABASE_URL to extract base DB name and connection string without DB
      baseDbName="${DATABASE_URL##*/}"
      dbUrlNoDb="${DATABASE_URL%/*}"

      # Safety check: only allow test databases
      if [[ ! "$baseDbName" =~ test ]]; then
        echo "Error: DATABASE_URL must contain '\''test'\'' in database name for safety"
        exit 1
      fi

      # Generate unique DB name with date and UUID (lowercase)
      dateStr=$(date +%Y%m%d)
      if command -v uuidgen >/dev/null 2>&1; then
        runId=$(uuidgen | tr -d '\''-'\'' | tr '\''[:upper:]'\'' '\''[:lower:]'\'' | cut -c1-8)
      else
        # Fallback: use timestamp + random number
        runId=$(date +%s%N | sha256sum | cut -c1-8 | tr '\''[:upper:]'\'' '\''[:lower:]'\'')
      fi
      dynamicDbName="${baseDbName}_${dateStr}_${runId}"

      echo "Creating dynamic test database: $dynamicDbName"
      psql "$dbUrlNoDb" -c "CREATE DATABASE \"$dynamicDbName\";" 2>&1 || {
        echo "Warning: Database creation may have failed, but continuing..."
      }

      # Set DATABASE_URL to use dynamic database
      export DATABASE_URL="${dbUrlNoDb}/${dynamicDbName}"

      # Cleanup function to drop dynamic database
      cleanup_db() {
        echo "Cleaning up dynamic test database: $dynamicDbName"
        psql "$dbUrlNoDb" -c "DROP DATABASE IF EXISTS \"$dynamicDbName\" WITH (FORCE);" > /dev/null 2>&1 || true
      }

      # Register cleanup trap for exit and signals (including Ctrl+C)
      trap cleanup_db EXIT INT TERM

      # Run migrations on dynamic database
      if [ -f "schema.prisma" ] || [ -f "prisma/schema.prisma" ] || [ -f "prisma.config.ts" ]; then
        npx prisma migrate deploy > /dev/null 2>&1
        npx prisma generate
      fi
    fi

    if [ $# -eq 0 ]; then
      bun test --randomize
    else
      bun test "$@"
    fi
  ' bash "$@"
fi
