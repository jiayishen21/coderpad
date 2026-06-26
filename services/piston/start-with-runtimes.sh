#!/usr/bin/env sh
set -eu

PISTON_URL="http://127.0.0.1:${PORT:-2000}"

node /piston_api/src/index.js &
PISTON_PID="$!"

echo "Waiting for Piston API at ${PISTON_URL}..."
for i in $(seq 1 60); do
  if node /install-runtimes.cjs; then
    echo "Piston runtimes are ready."
    wait "$PISTON_PID"
    exit $?
  fi

  echo "Piston runtime installation attempt ${i} failed; retrying..."
  sleep 2
done

echo "Failed to install Piston runtimes."
kill "$PISTON_PID"
exit 1
