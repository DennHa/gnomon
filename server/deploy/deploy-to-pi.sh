#!/usr/bin/env bash
# Copy the server to the Pi and (re)build it there. Usage: server/deploy/deploy-to-pi.sh user@your-pi [dir]
# Only src/ (shared API logic and the web app), server/, and the app's package.json and CHANGELOG.md are copied. The data lives in the Docker volume gnomon_gnomon-data, not in
# the copied folder, so redeploying never touches it.
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <user@pi-host> [target-dir]"
  echo "Example: $0 user@your-pi /home/user/gnomon"
  exit 1
fi

PI_HOST="$1"
PI_USER="${PI_HOST%%@*}"
TARGET_DIR="${2:-/home/${PI_USER}/gnomon}"
REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

echo "[1/5] Check the Pi: Docker, and the proxy-net network shared with cloudflared"
ssh "${PI_HOST}" "docker network inspect proxy-net >/dev/null" || {
  echo "proxy-net doesn't exist on the Pi. Is the Cloudflare Tunnel set up there?"
  exit 1
}

echo "[2/5] Sync to ${PI_HOST}:${TARGET_DIR}"
ssh "${PI_HOST}" "mkdir -p '${TARGET_DIR}'"
rsync -az --delete \
  --exclude 'node_modules' --exclude 'dist' --exclude 'dist-test' --exclude '.data' --exclude '.env' --exclude 'docker-compose.override.yml' --exclude '.DS_Store' \
  "${REPO_DIR}/src" "${REPO_DIR}/server" "${REPO_DIR}/package.json" "${REPO_DIR}/CHANGELOG.md" "${PI_HOST}:${TARGET_DIR}/"

echo "[3/5] Build and start (the first build on a Pi takes a few minutes)"
ssh "${PI_HOST}" "cd '${TARGET_DIR}/server' && docker compose config --quiet && docker compose up -d --build"

echo "[4/5] Status"
ssh "${PI_HOST}" "cd '${TARGET_DIR}/server' && docker compose ps"
sleep 5
ssh "${PI_HOST}" "docker exec gnomon node -e \"fetch('http://127.0.0.1:8080/healthz').then(r=>{console.log('health:',r.status);process.exit(r.ok?0:1)})\""

echo "[5/5] Recent logs"
ssh "${PI_HOST}" "cd '${TARGET_DIR}/server' && docker compose logs --tail=20 gnomon"

echo
echo "Done. Pair a phone with:  ssh ${PI_HOST} docker exec gnomon gnomon-admin pair \"iPhone\""
