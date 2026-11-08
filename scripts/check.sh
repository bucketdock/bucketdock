#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

check_frontend() {
  pnpm lint
  pnpm test
  pnpm build
}

check_backend() {
  cargo check --manifest-path src-tauri/Cargo.toml --locked --all-targets
  cargo test --manifest-path src-tauri/Cargo.toml --locked --no-fail-fast
}

check_all() {
  pnpm install --frozen-lockfile
  check_frontend
  check_backend
}

case "${1:-all}" in
  frontend)
    check_frontend
    ;;
  backend)
    check_backend
    ;;
  all)
    check_all
    ;;
  release)
    check_all
    rustup target add aarch64-apple-darwin x86_64-apple-darwin
    for target in aarch64-apple-darwin x86_64-apple-darwin; do
      # CI mode avoids interactive Finder automation during DMG creation.
      CI=true pnpm tauri build --target "$target" --no-sign --ci -- --locked
    done
    ;;
  *)
    echo "Usage: bash scripts/check.sh [all|frontend|backend|release]" >&2
    exit 2
    ;;
esac
