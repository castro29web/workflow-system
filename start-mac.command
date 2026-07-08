#!/bin/zsh
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to run Workflow System."
  echo "Install Node.js 20 or newer from https://nodejs.org, then run this file again."
  read "?Press Return to close."
  exit 1
fi

export HOST=0.0.0.0
export PORT=${PORT:-3000}
export ACCESS_PIN=${ACCESS_PIN:-7875}
export DATA_FILE=${DATA_FILE:-./data/queue.json}

echo "Workflow System is starting..."
echo "This computer: http://localhost:${PORT}"
echo "Other devices on the same network: http://THIS-COMPUTER-IP:${PORT}"
echo "Keep this window open while employees use the app."
node server.js

