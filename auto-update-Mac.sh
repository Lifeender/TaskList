#!/usr/bin/env bash
# ==============================================================================
# TaskList Extension — GitHub Auto-Updater for MacBook (macOS)
# ==============================================================================
# Usage:
#   ./auto-update-Mac.sh             -> Pulls latest changes from GitHub now
#   ./auto-update-Mac.sh --install   -> Installs a macOS LaunchAgent that silently
#                                       runs `git pull` every 15 minutes in the background
#   ./auto-update-Mac.sh --uninstall -> Removes the macOS LaunchAgent
# ==============================================================================

set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

PLIST_LABEL="com.lifeender.tasklist.autoupdater"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"

pull_latest() {
  echo "[$(date '+%H:%M:%S')] Checking GitHub for TaskList updates in $REPO_DIR..."
  BEFORE_SHA=$(git rev-parse HEAD 2>/dev/null || echo "")
  git pull --ff-only
  AFTER_SHA=$(git rev-parse HEAD 2>/dev/null || echo "")

  if [ "$BEFORE_SHA" != "$AFTER_SHA" ]; then
    echo "Updated TaskList extension to commit ${AFTER_SHA:0:7}!"
  else
    echo "Already up to date (${AFTER_SHA:0:7})."
  fi
}

case "${1:-}" in
  --install)
    mkdir -p "$HOME/Library/LaunchAgents"
    cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${REPO_DIR}/auto-update-Mac.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${REPO_DIR}</string>
  <key>StartInterval</key>
  <integer>900</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/tasklist-autoupdate.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/tasklist-autoupdate.err</string>
</dict>
</plist>
EOF
    launchctl unload "$PLIST_PATH" 2>/dev/null || true
    launchctl load "$PLIST_PATH"
    echo "Installed macOS LaunchAgent! Your MacBook will silently run 'git pull' every 15 minutes."
    pull_latest
    ;;
  --uninstall)
    launchctl unload "$PLIST_PATH" 2>/dev/null || true
    rm -f "$PLIST_PATH"
    echo "Removed macOS LaunchAgent."
    ;;
  *)
    pull_latest
    ;;
esac
