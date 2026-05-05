#!/usr/bin/env bash
# Mirror the CI checks locally.
#
#   scripts/check.sh fast      typecheck + lint + cargo fmt --check + clippy
#   scripts/check.sh autofix   typecheck + eslint --fix + cargo fmt + clippy --fix
#   scripts/check.sh test      cargo test + vitest
#   scripts/check.sh full      everything (no autofix)

set -uo pipefail

cd "$(dirname "$0")/.."

mode="${1:-full}"

step() { printf "\n\033[1;34m==> %s\033[0m\n" "$1"; }
fail() { printf "\n\033[1;31m✗ %s failed\033[0m\n" "$1" >&2; exit 1; }

run() {
  local name=$1; shift
  step "$name"
  "$@" || fail "$name"
}

typecheck()  { run "typecheck"           npm run typecheck; }
lint()       { run "eslint"              npm run lint; }
lint_fix()   { run "eslint --fix"        npx --no-install eslint src --fix; }
fmt_check()  { run "cargo fmt --check"   cargo fmt --check; }
fmt_fix()    { run "cargo fmt"           cargo fmt; }
clippy()     { run "cargo clippy"        cargo clippy -p review-core --all-targets -- -D warnings; }
clippy_fix() { run "cargo clippy --fix"  cargo clippy --fix --allow-dirty --allow-staged --allow-no-vcs -p review-core --all-targets -- -D warnings; }
test_rust()  { run "cargo test"          cargo test -p review-core; }
test_js()    { run "vitest"              npm test; }

case "$mode" in
  fast)    typecheck; lint;     fmt_check; clippy ;;
  autofix) typecheck; lint_fix; fmt_fix;   clippy_fix ;;
  test)    test_rust; test_js ;;
  full)    typecheck; lint;     fmt_check; clippy; test_rust; test_js ;;
  -h|--help|help)
    sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  *)
    printf "unknown mode: %s\n" "$mode" >&2
    sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//' >&2
    exit 2
    ;;
esac

printf "\n\033[1;32m✓ %s passed\033[0m\n" "$mode"
