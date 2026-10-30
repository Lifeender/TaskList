#!/usr/bin/env bash
# ==============================================================================
# TaskList Extension — One-Step MacBook Setup & Auto-Updater Installer
# ==============================================================================
set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

echo "========================================================"
echo "  TaskList Chrome Extension — MacBook Setup"
echo "========================================================"

# 1. Strip Windows CRLF line endings if present so scripts run cleanly on macOS
sed -i '' 's/\r$//' "$REPO_DIR/auto-update-Mac.sh" 2>/dev/null || true
chmod +x "$REPO_DIR/auto-update-Mac.sh"

# 2. Install the macOS LaunchAgent so the MacBook auto-pulls updates from GitHub every 15m
"$REPO_DIR/auto-update-Mac.sh" --install

echo ""
echo "✅ Background GitHub Auto-Updater is now active!"
echo "👉 Final step in Chrome (takes 10 seconds):"
echo "   1. In Chrome, go to: chrome://extensions"
echo "   2. Toggle 'Developer mode' ON (top-right)"
echo "   3. Click 'Load unpacked' and select this folder:"
echo "      $REPO_DIR"
echo "========================================================"

# Open Chrome to the extensions page convenience
open -a "Google Chrome" "http://extensions" 2>/dev/null || true
