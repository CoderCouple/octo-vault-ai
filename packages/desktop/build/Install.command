#!/bin/bash
# OctoVault AI — one-click Gatekeeper unlock.
#
# Why this exists: macOS Gatekeeper flags any unsigned app downloaded from
# the internet as "damaged" (it isn't — it's just unsigned). The fix is to
# remove the com.apple.quarantine extended attribute. This script does that
# in one double-click so beta users don't have to type into Terminal.
#
# Run order: drag OctoVault.app to /Applications first, THEN double-click
# this file. macOS will open Terminal, run xattr, and confirm.

set -e

APP="/Applications/OctoVault.app"

clear
cat <<'BANNER'
─────────────────────────────────────────────────────
  OctoVault AI · Beta · first-launch fix
─────────────────────────────────────────────────────

This removes the macOS quarantine flag from the app
so Gatekeeper stops blocking it.

It does NOT change, modify, or run the app — it only
clears one extended attribute. You can verify with:

    xattr /Applications/OctoVault.app

─────────────────────────────────────────────────────
BANNER

if [ ! -d "$APP" ]; then
  echo "✗ Couldn't find $APP"
  echo
  echo "  Drag OctoVault.app to your Applications folder first,"
  echo "  then double-click this Install.command again."
  echo
  read -r -p "Press return to close…"
  exit 1
fi

echo "→ Clearing quarantine flag on $APP …"
xattr -dr com.apple.quarantine "$APP"

echo
echo "✓ Done. You can now open OctoVault from Launchpad or /Applications."
echo
read -r -p "Press return to close…"
