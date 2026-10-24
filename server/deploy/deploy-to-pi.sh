#!/usr/bin/env bash
# Copy the server to the Pi and (re)build it there. Usage: server/deploy/deploy-to-pi.sh user@your-pi [dir]
# Only src/ (shared API logic), server/ and docs/ROADMAP.md (the /roadmap page) are copied. The data lives in the Docker volume gnomon_gnomon-data, not in
# the copied folder, so redeploying never touches it; it is still backed up to ~/backups on the Pi first.
# Files that only exist on the Pi (.env*, docker-compose.override.yml and its .bak copies) are never overwritten or deleted.
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

echo "[1/6] Check the Pi: Docker, and the proxy-net network shared with cloudflared"
ssh "${PI_HOST}" "docker network inspect proxy-net >/dev/null" || {
  echo "proxy-net doesn't exist on the Pi. Is the Cloudflare Tunnel set up there?"
  exit 1
}

echo "[2/6] Back up the database to ~/backups on the Pi"
STAMP="$(date +%Y%m%d-%H%M%S)"
ssh "${PI_HOST}" "if docker ps -q --filter name=^gnomon\$ | grep -q .; then
  mkdir -p ~/backups && docker cp gnomon:/data/gnomon.db ~/backups/gnomon-${STAMP}-pre-deploy.db &&
  for ext in wal shm; do docker cp gnomon:/data/gnomon.db-\$ext ~/backups/gnomon-${STAMP}-pre-deploy.db-\$ext 2>/dev/null || true; done &&
  echo \"backup: ~/backups/gnomon-${STAMP}-pre-deploy.db\"
else echo 'no running gnomon container yet, nothing to back up'; fi"

echo "[3/6] Sync to ${PI_HOST}:${TARGET_DIR}"
ssh "${PI_HOST}" "mkdir -p '${TARGET_DIR}'"
# --delete removes files that left the repo, but never excluded ones: the Pi's own settings and their backups stay.
rsync -az --delete \
  --exclude 'node_modules' --exclude 'dist' --exclude 'dist-test' --exclude '.data' --exclude 'data' --exclude '.env*' \
  --exclude 'docker-compose.override.yml*' --exclude '.DS_Store' \
  "${REPO_DIR}/src" "${REPO_DIR}/server" "${PI_HOST}:${TARGET_DIR}/"
ssh "${PI_HOST}" "mkdir -p '${TARGET_DIR}/docs'"
rsync -az "${REPO_DIR}/docs/ROADMAP.md" "${PI_HOST}:${TARGET_DIR}/docs/ROADMAP.md"

echo "[4/6] Build and start (the first build on a Pi takes a few minutes)"
ssh "${PI_HOST}" "cd '${TARGET_DIR}/server' && docker compose config --quiet && docker compose up -d --build"

echo "[5/6] Status"
ssh "${PI_HOST}" "cd '${TARGET_DIR}/server' && docker compose ps"
sleep 5
ssh "${PI_HOST}" "docker exec gnomon node -e \"fetch('http://127.0.0.1:8080/healthz').then(r=>{console.log('health:',r.status);process.exit(r.ok?0:1)})\""

echo "[6/6] Recent logs"
ssh "${PI_HOST}" "cd '${TARGET_DIR}/server' && docker compose logs --tail=20 gnomon"

echo
echo "Done. Pair a phone with:  ssh ${PI_HOST} docker exec gnomon gnomon-admin pair \"iPhone\""
