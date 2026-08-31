#!/usr/bin/env bash
# Read-only report on this machine's native development toolchain.
#
# STRICTLY READ-ONLY. It never installs, deletes, moves or modifies
# anything — no package installs, no writes outside stdout. Safe to run at
# any time.
#
# Usage: bash scripts/check-native-dev-env.sh
#
# Always exits 0: this is a report, not a gate. Read the OK / -- marks.

set -uo pipefail

ok()    { printf "  \033[32mOK\033[0m    %-24s %s\n" "$1" "$2"; }
miss()  { printf "  \033[33m--\033[0m    %-24s %s\n" "$1" "$2"; }
bad()   { printf "  \033[31mXX\033[0m    %-24s %s\n" "$1" "$2"; }
head_() { printf "\n\033[1m%s\033[0m\n" "$1"; }

head_ "System"
printf "  %-29s %s\n" "macOS"  "$(sw_vers -productVersion 2>/dev/null) ($(sw_vers -buildVersion 2>/dev/null))"
printf "  %-29s %s\n" "arch"   "$(uname -m)"
printf "  %-29s %s\n" "model"  "$(sysctl -n hw.model 2>/dev/null)"
printf "  %-29s %s GB\n" "RAM" "$(sysctl -n hw.memsize 2>/dev/null | awk '{printf "%.0f", $1/1073741824}')"
printf "  %-29s %s\n" "cores"  "$(sysctl -n hw.ncpu 2>/dev/null)"

head_ "Storage"
df -g / 2>/dev/null | tail -1 | awk '{printf "  %-29s %s GiB free of %s GiB\n", "internal", $4, $2}'
if [ -d "/Volumes/T7 Shield" ]; then
  df -g "/Volumes/T7 Shield" 2>/dev/null | tail -1 | awk '{printf "  %-29s %s GiB free of %s GiB\n", "T7 Shield", $4, $2}'
  printf "  %-29s %s\n" "T7 filesystem" "$(diskutil info "/Volumes/T7 Shield" 2>/dev/null | awk -F': *' '/File System Personality/{print $2}')"
else
  miss "T7 Shield" "not mounted"
fi

head_ "Node toolchain"
command -v node     >/dev/null && ok "node" "$(node -v)"                                  || miss "node" "not found"
command -v npm      >/dev/null && ok "npm"  "$(npm -v)"                                   || miss "npm"  "not found"
command -v brew     >/dev/null && ok "homebrew" "$(brew --version 2>/dev/null | head -1)" || miss "homebrew" "not found"
command -v watchman >/dev/null && ok "watchman" "$(watchman --version 2>/dev/null)"       || miss "watchman" "not installed (optional)"

head_ "Java"
[ -x /usr/libexec/java_home ] && printf "  %-29s %s\n" "default (java_home)" "$(/usr/libexec/java_home 2>/dev/null || echo none)"
JDK17="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
if [ -x "$JDK17/bin/java" ]; then
  ok "JDK 17 (Android builds)" "$("$JDK17/bin/java" -version 2>&1 | head -1)"
else
  miss "JDK 17 (Android builds)" "not at $JDK17"
fi
printf "  %-29s %s\n" "JAVA_HOME" "${JAVA_HOME:-<unset>}"

head_ "Apple / iOS"
printf "  %-29s %s\n" "xcode-select" "$(xcode-select -p 2>/dev/null || echo none)"
if [ -d /Applications/Xcode.app ]; then
  XV="$(xcodebuild -version 2>&1 | head -1)"
  case "$XV" in
    *"license"*) bad "Xcode" "installed, LICENCE NOT ACCEPTED — run: sudo xcodebuild -license accept" ;;
    *)           ok  "Xcode" "$XV" ;;
  esac
else
  miss "Xcode" "NOT INSTALLED — iOS builds unavailable"
fi
if xcrun simctl help >/dev/null 2>&1; then
  ok "simctl" "available"
  printf "  %-29s %s\n" "iOS runtimes" "$(xcrun simctl list runtimes 2>/dev/null | grep -c '^iOS' || echo 0)"
else
  miss "simctl" "unavailable (needs full Xcode + accepted licence)"
fi
command -v pod >/dev/null && ok "cocoapods" "$(pod --version 2>/dev/null)" || miss "cocoapods" "not installed (Expo prebuild installs it when needed)"

head_ "Android"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
printf "  %-29s %s\n" "ANDROID_HOME"     "${ANDROID_HOME:-<unset>}"
printf "  %-29s %s\n" "ANDROID_SDK_ROOT" "${ANDROID_SDK_ROOT:-<unset>}"
[ -d "$SDK" ] && ok "SDK" "$SDK ($(du -sh "$SDK" 2>/dev/null | cut -f1))" || miss "SDK" "not found at $SDK"
[ -d "/Applications/Android Studio.app" ] && ok "Android Studio" "installed" \
  || miss "Android Studio" "not installed (CLI toolchain is sufficient)"
if [ -x "$SDK/platform-tools/adb" ]; then
  ok "adb" "$("$SDK/platform-tools/adb" version 2>/dev/null | head -1)"
  printf "  %-29s %s\n" "attached devices" "$("$SDK/platform-tools/adb" devices 2>/dev/null | tail -n +2 | grep -c 'device$' || echo 0)"
else
  miss "adb" "not found"
fi
if [ -x "$SDK/emulator/emulator" ]; then
  ok "emulator" "$("$SDK/emulator/emulator" -version 2>/dev/null | head -1 | cut -c1-44)"
  printf "  %-29s %s\n" "AVDs" "$("$SDK/emulator/emulator" -list-avds 2>/dev/null | tr '\n' ' ')"
else
  miss "emulator" "not found"
fi

head_ "Expo"
if [ -d apps/customer-runner ]; then
  ok "project" "apps/customer-runner present (run 'npx expo --version' there)"
else
  miss "project" "run this script from the repo root"
fi
command -v eas >/dev/null && ok "eas-cli (global)" "$(eas --version 2>/dev/null | head -1)" \
  || miss "eas-cli (global)" "not global — use 'npx eas-cli' (preferred)"

printf "\n\033[1mNotes\033[0m\n"
printf "  Read-only: this script changes nothing.\n"
printf "  Context: docs/engineering/NATIVE_DEV_ENVIRONMENT_SETUP_REPORT.md\n\n"
