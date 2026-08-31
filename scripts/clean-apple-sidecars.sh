#!/usr/bin/env bash
# Remove macOS AppleDouble sidecar files (`._name`) from this repository.
#
# Why this exists
# ---------------
# The repository lives on an exFAT volume (docs/audit/
# PHASE_0_REPOSITORY_AUDIT.md). exFAT cannot store macOS resource forks or
# extended attributes inline, so the OS writes a companion `._name` file
# next to every file it touches. They are gitignored and harmless to git —
# but they are binary, and every native build tool that *globs* for files
# picks them up and chokes:
#
#   Metro       TransformError: app/(auth)/._verify.tsx
#                 SyntaxError: Unexpected character (1:0)
#   CocoaPods   Invalid podspec file at .../ios/._ExpoDomWebView.podspec
#   CocoaPods   Could not automatically select an Xcode project
#                 (._Craavee.xcodeproj shadows the real one)
#   Supabase    Skipping migration ._0001_init.sql...
#
# Metro is handled permanently by `resolver.blockList` in
# apps/customer-runner/metro.config.js. CocoaPods has no equivalent knob —
# `use_expo_modules!` globs podspecs out of node_modules — so the files have
# to actually be gone before `pod install` runs.
#
# Safety
# ------
# Deletes ONLY files whose basename begins with `._`, and only inside this
# repository. Those files hold nothing but macOS metadata for files that are
# themselves either tracked by git or regenerable (node_modules, ios/,
# android/). Nothing tracked by git is ever removed — verified below.
#
# They come back whenever macOS touches a file, so this is a step to run
# before a native build, not a one-time fix.
#
# Usage:
#   bash scripts/clean-apple-sidecars.sh          # clean
#   bash scripts/clean-apple-sidecars.sh --dry-run # count only

set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
REPO="$(pwd)"

DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

# Refuse to run anywhere unexpected.
case "$REPO" in
  */craavee_web_v1) ;;
  *) echo "refusing to run outside the Craavee repository (got: $REPO)" >&2; exit 1 ;;
esac

COUNT=$(find . -name '._*' -type f 2>/dev/null | wc -l | tr -d ' ')
echo "AppleDouble sidecars found: $COUNT"

if [ "$COUNT" = "0" ]; then
  echo "nothing to do"
  exit 0
fi

# Paranoia: none of these should ever be tracked. If one is, stop rather
# than delete something the repository actually depends on.
TRACKED=$(git ls-files | grep -c '\(^\|/\)\._' || true)
if [ "${TRACKED:-0}" != "0" ]; then
  echo "ABORT: $TRACKED sidecar file(s) are tracked by git — not deleting anything" >&2
  exit 1
fi

if [ "$DRY" = "1" ]; then
  echo "(dry run — nothing deleted)"
  exit 0
fi

find . -name '._*' -type f -delete 2>/dev/null
echo "removed; remaining: $(find . -name '._*' -type f 2>/dev/null | wc -l | tr -d ' ')"
