#!/usr/bin/env bash
set -Eeuo pipefail
APP_DIR="${1:-$(pwd)}"; cd "$APP_DIR"
for i in $(seq 1 25); do
  OUT="$(timeout 8 node src/app.js 2>&1 >/tmp/ag-node-test.out || true)"
  pkill -f "$APP_DIR/src/app.js" 2>/dev/null || true
  echo "$OUT" | grep -q "Cannot find module" || { echo "[missing] no missing module detected"; exit 0; }
  MOD="$(echo "$OUT" | sed -n "s/.*Cannot find module '\\([^']*\\)'.*/\\1/p" | head -1)"
  [ -n "$MOD" ] || exit 0
  case "$MOD" in ./*|../*|/*) echo "[missing] local missing module: $MOD"; echo "$OUT"; exit 0;; esac
  PKG="$MOD"
  case "$PKG" in @*/*) PKG="$(echo "$PKG" | cut -d/ -f1,2)";; *) PKG="$(echo "$PKG" | cut -d/ -f1)";; esac
  echo "[missing] installing $PKG"
  npm install "$PKG" --save --omit=dev --legacy-peer-deps || true
done
