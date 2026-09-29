#!/bin/bash
# Mac: double-click this file to start the Wallet Tracker.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get the LTS version from https://nodejs.org, then try again."
  read -r -p "Press Enter to close..."
  exit 1
fi
[ -f .env ] || cp .env.example .env
(sleep 2 && open "http://localhost:3000") &
# caffeinate keeps your Mac from sleeping while the tracker runs.
caffeinate -i node src/server.js
read -r -p "Tracker stopped. Press Enter to close..."
