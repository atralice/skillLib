#!/bin/bash

# Run tests for a specific group after splitting all tests
# Usage: runTestGroup.sh <group_index>
# Should be run from the project directory

set -euo pipefail

GROUP_INDEX="${1:-}"

if [ -z "$GROUP_INDEX" ]; then
  echo "Error: Group index required"
  echo "Usage:  <group_index>"
  exit 1
fi

# Total groups is provided by CI (see .github/workflows/test.yml).
# Default to 1 for local runs.
TOTAL_GROUPS="${TOTAL_GROUPS:-1}"

# Get all test files and split into N groups (round-robin for balance)
TEST_FILES=$(
  npx jest --listTests --json 2>/dev/null | jq -r \
    --argjson group "${GROUP_INDEX}" \
    --argjson total "${TOTAL_GROUPS}" \
    'to_entries
     | map(select((.key % $total) == $group))
     | .[].value'
)

# Extract test files for this group and make them relative to current directory
TEST_FILES_ARRAY=()
while IFS= read -r line; do
  RELATIVE_PATH=$(echo "$line" | sed "s|^$(pwd)/||")
  TEST_FILES_ARRAY+=("$RELATIVE_PATH")
done < <(echo "$TEST_FILES")

# Run tests for this group with TEST_GROUP environment variable set
TEST_GROUP=${GROUP_INDEX} pnpm test "${TEST_FILES_ARRAY[@]}"
