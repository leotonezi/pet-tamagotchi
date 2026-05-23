#!/usr/bin/env bash
# Mirrors .github/workflows/rust.yml — run before opening PRs.
# Usage: bash scripts/ci-local.sh
#        bash scripts/ci-local.sh --skip-build   (skip anchor build, tsc only)
set -euo pipefail

SKIP_BUILD=false
for arg in "$@"; do [[ "$arg" == "--skip-build" ]] && SKIP_BUILD=true; done

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $*"; }
fail() { echo -e "${RED}✗${NC} $*"; exit 1; }
step() { echo -e "\n${YELLOW}▶ $*${NC}"; }

step "npm ci"
npm ci || fail "npm ci failed"
ok "npm ci"

step "cargo clippy"
cargo clippy -- -D warnings || fail "clippy failed"
ok "cargo clippy"

if [[ "$SKIP_BUILD" == false ]]; then
  step "anchor build"
  anchor build || fail "anchor build failed"
  ok "anchor build"
else
  echo "(skipped anchor build)"
fi

step "tsc --noEmit"
npx tsc --noEmit || fail "tsc failed"
ok "tsc"

step "anchor test"
anchor test --skip-local-validator || fail "anchor test failed"
ok "anchor test"

echo -e "\n${GREEN}All CI checks passed.${NC}"
