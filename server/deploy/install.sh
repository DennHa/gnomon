#!/bin/sh
# Install a Gnomon server on a Linux machine with Docker. See docs/admin-guide.md.
#
#   curl -fsSL https://raw.githubusercontent.com/DennHa/gnomon/main/server/deploy/install.sh -o install.sh
#   sudo sh install.sh
#
# It asks a few questions (or takes them as options, for scripted installs), then writes a folder (default /opt/gnomon)
# with compose.yml and .env (with a newly generated secret key and data key), puts gnomon-admin on this machine, starts the server,
# sets a backup password and shows it once, and prints the one-time link to the setup page.
#
# Options:
#   --dir DIR             Install folder (default /opt/gnomon)
#   --https MODE          caddy | caddy-own | proxy | tunnel | local
#   --domain NAME         The server's host name, e.g. gnomon.example.com (caddy, caddy-own, proxy, tunnel)
#   --cert FILE --key FILE  Your own certificate and key, PEM (caddy-own)
#   --bind ADDR --port N  Where Gnomon listens on this machine (proxy, local; default 127.0.0.1 or 0.0.0.0, and 8080)
#   --tunnel-token TOKEN  The Cloudflare Tunnel's token (tunnel)
#   --tz ZONE             Time zone for "which day" (default: this machine's, else Europe/Berlin)
#   --version V           Server version to install (default: latest)
#   --build               Build the image from the source code instead of pulling the published one
#   --image NAME          Use this image instead, e.g. from your own registry (registry.example.com/gnomon-server:1.2.3)
#   --no-start            Only write the folder and check it; start later with `docker compose up -d` there
#   --yes                 Don't ask; take the options and defaults
set -eu

REPO="DennHa/gnomon"
IMAGE_REPO="ghcr.io/dennha/gnomon-server"
DIR="/opt/gnomon"
MODE=""
DOMAIN=""
CERT=""
KEY=""
BIND=""
PORT="8080"
TUNNEL_TOKEN=""
TZONE=""
VERSION="latest"
BUILD=0
YES=0
START=1
OWN_IMAGE=""
RAW_BASE="${GNOMON_RAW_BASE:-https://raw.githubusercontent.com/$REPO}"

say() { printf '%s\n' "$*"; }
ok() { printf '✓ %s\n' "$*"; }
die() { printf '✗ %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --https) MODE="$2"; shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    --cert) CERT="$2"; shift 2 ;;
    --key) KEY="$2"; shift 2 ;;
    --bind) BIND="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --tunnel-token) TUNNEL_TOKEN="$2"; shift 2 ;;
    --tz) TZONE="$2"; shift 2 ;;
    --version) VERSION="${2#v}"; shift 2 ;;
    --build) BUILD=1; shift ;;
    --image) OWN_IMAGE="$2"; shift 2 ;;
    --no-start) START=0; shift ;;
    --yes|-y) YES=1; shift ;;
    -h|--help) sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Unknown option $1 (see --help)" ;;
  esac
done

# Questions go to the terminal even when the script itself comes through a pipe.
TTY=/dev/tty
if [ "$YES" -eq 0 ] && ! (: <"$TTY") 2>/dev/null; then YES=1; fi
ask() { # ask VAR "Question" default
  if [ "$YES" -eq 1 ]; then eval "$1=\${$1:-\$3}"; return; fi
  eval "cur=\${$1:-\$3}"
  printf '%s [%s]: ' "$2" "$cur" >"$TTY"
  read -r answer <"$TTY" || answer=""
  eval "$1=\${answer:-\$cur}"
}
ask_secret() { # ask_secret VAR "Question"
  [ "$YES" -eq 1 ] && return
  eval "cur=\${$1:-}"
  [ -n "$cur" ] && return
  printf '%s: ' "$2" >"$TTY"
  stty -echo <"$TTY" 2>/dev/null || true
  read -r answer <"$TTY" || answer=""
  stty echo <"$TTY" 2>/dev/null || true
  printf '\n' >"$TTY"
  eval "$1=\$answer"
}

# ---- 1. What's here ------------------------------------------------------------------------------

say "Gnomon server install"
command -v docker >/dev/null 2>&1 || die "Docker isn't installed. Install Docker Engine first: https://docs.docker.com/engine/install/"
docker info >/dev/null 2>&1 || die "Can't talk to Docker. Run this as root (sudo) or as a user in the docker group."
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is missing (the 'docker compose' command). Install the docker-compose-plugin package."
ARCH="$(uname -m)"
case "$ARCH" in x86_64|amd64|aarch64|arm64) ;; *) [ "$BUILD" -eq 1 ] || die "No published image for $ARCH. Use --build to build it here." ;; esac
ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null) with Compose $(docker compose version --short 2>/dev/null) · $ARCH"

ask DIR "Install folder" "$DIR"
if [ -f "$DIR/compose.yml" ]; then
  die "$DIR already has a Gnomon server. Update it with: gnomon-admin update"
fi

# ---- 2. How people reach it over HTTPS -----------------------------------------------------------

if [ -z "$MODE" ] && [ "$YES" -eq 0 ]; then
  cat >"$TTY" <<'EOF'
How do people reach this server over HTTPS?
  1) Caddy gets a free certificate from Let's Encrypt (needs a domain pointing here, ports 80 and 443 open)
  2) Caddy with your own certificate files (your company's certificate authority or a wildcard certificate)
  3) Your own reverse proxy or load balancer (nginx, Traefik, F5…): Gnomon only listens on a port
  4) Cloudflare Tunnel: no open ports; Cloudflare handles HTTPS
  5) Local test, no HTTPS (not for real use)
EOF
  CHOICE=""
  ask CHOICE "Choice" "1"
  case "$CHOICE" in 1) MODE=caddy ;; 2) MODE=caddy-own ;; 3) MODE=proxy ;; 4) MODE=tunnel ;; 5) MODE=local ;; *) die "Choose 1 to 5" ;; esac
fi
[ -n "$MODE" ] || MODE=local
case "$MODE" in caddy|caddy-own|proxy|tunnel|local) ;; *) die "--https must be caddy, caddy-own, proxy, tunnel or local" ;; esac

if [ "$MODE" != local ]; then
  ask DOMAIN "The server's host name (like gnomon.example.com)" "$DOMAIN"
  printf '%s' "$DOMAIN" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$' || die "That isn't a host name like gnomon.example.com"
  PUBLIC_URL="https://$DOMAIN"
fi
case "$MODE" in
  caddy-own)
    ask CERT "Certificate file (PEM, with the chain)" "$CERT"
    ask KEY "Private key file (PEM)" "$KEY"
    [ -f "$CERT" ] && [ -f "$KEY" ] || die "Both the certificate and the key file are needed"
    ;;
  proxy)
    ask BIND "Listen on address (127.0.0.1 if the proxy runs on this machine)" "${BIND:-127.0.0.1}"
    ask PORT "Port" "$PORT"
    ;;
  tunnel)
    say "In Cloudflare: Zero Trust → Networks → Tunnels → Create a tunnel (Cloudflared), copy its token,"
    say "and add a public hostname $DOMAIN → Service HTTP → gnomon:8080."
    ask_secret TUNNEL_TOKEN "Tunnel token"
    [ -n "$TUNNEL_TOKEN" ] || die "The tunnel token is needed (--tunnel-token)"
    ;;
  local)
    ask BIND "Listen on address" "${BIND:-0.0.0.0}"
    ask PORT "Port" "$PORT"
    PUBLIC_URL="http://localhost:$PORT"
    ;;
esac
printf '%s' "$PORT" | grep -Eq '^[0-9]{1,5}$' || die "The port must be a number"

DEFAULT_TZ="$(cat /etc/timezone 2>/dev/null || readlink /etc/localtime 2>/dev/null | sed 's|.*/zoneinfo/||' || true)"
case "$DEFAULT_TZ" in ""|UTC|Etc/UTC) DEFAULT_TZ="Europe/Berlin" ;; esac
ask TZONE "Time zone (decides which day an entry belongs to)" "${TZONE:-$DEFAULT_TZ}"

# ---- 3. The folder -------------------------------------------------------------------------------

umask 077
mkdir -p "$DIR"
cd "$DIR"

random() { head -c "$1" /dev/urandom | base64 | tr -d '\n/+=' | head -c "$2"; }
SECRET_KEY="$(random 48 48)"
DATA_KEY="$(random 64 48)"
case "$MODE" in tunnel) TRUST=cloudflare ;; caddy|caddy-own|proxy) TRUST=proxy ;; *) TRUST=none ;; esac

if [ "$BUILD" -eq 1 ]; then
  command -v git >/dev/null 2>&1 || die "--build needs git"
  REF="main"
  [ "$VERSION" != latest ] && REF="v$VERSION"
  say "Getting the source code ($REF)…"
  git clone --quiet --depth 1 --branch "$REF" "https://github.com/$REPO.git" source
  IMAGE="gnomon-server:local"
elif [ -n "$OWN_IMAGE" ]; then
  IMAGE="$OWN_IMAGE"
else
  IMAGE="$IMAGE_REPO:$VERSION"
fi

cat >.env <<EOF
# Gnomon server settings. Keep this file safe: GNOMON_SECRET_KEY encrypts the integration tokens and the email password
# stored on the server. If it's lost, they have to be entered again (nothing else is lost). See docs/admin-guide.md.
# GNOMON_DATA_KEY encrypts all data (times, people, projects) on disk. If it's lost, THE DATA IS LOST: only a backup
# and its backup password bring it back. Keep a copy in your password manager.
GNOMON_IMAGE=$IMAGE
GNOMON_PUBLIC_URL=${PUBLIC_URL}
GNOMON_TZ=$TZONE
GNOMON_SECRET_KEY=$SECRET_KEY
GNOMON_DATA_KEY=$DATA_KEY
GNOMON_HTTPS=$MODE
GNOMON_TRUST_PROXY=$TRUST
GNOMON_DOMAIN=$DOMAIN
GNOMON_BIND=${BIND:-127.0.0.1}
GNOMON_PORT=$PORT
TUNNEL_TOKEN=$TUNNEL_TOKEN
EOF
chmod 600 .env

# The compose file: Gnomon itself, plus Caddy or cloudflared when they do HTTPS.
{
  cat <<'EOF'
# Gnomon server, written by install.sh. Settings are in .env; manage it with gnomon-admin (status, update, backup…).
services:
  gnomon:
    image: ${GNOMON_IMAGE}
EOF
  if [ "$BUILD" -eq 1 ]; then
    cat <<'EOF'
    build:
      context: ./source
      dockerfile: server/Dockerfile
EOF
  fi
  cat <<'EOF'
    container_name: gnomon
    restart: unless-stopped
    environment:
      TZ: ${GNOMON_TZ}
      GNOMON_PUBLIC_URL: ${GNOMON_PUBLIC_URL}
      GNOMON_SECRET_KEY: ${GNOMON_SECRET_KEY}
      GNOMON_DATA_KEY: ${GNOMON_DATA_KEY}
      GNOMON_HTTPS: ${GNOMON_HTTPS}
      GNOMON_TRUST_PROXY: ${GNOMON_TRUST_PROXY}
      # Optional: a folder with the Mac app instead of GitHub or an upload (see docs/admin-guide.md).
      # GNOMON_RELEASES_DIR: /releases
      # Optional: your company's certificate authority, so the setup page's HTTPS check trusts it.
      # NODE_EXTRA_CA_CERTS: /certs/company-ca.pem
    volumes:
      - gnomon-data:/data
EOF
  case "$MODE" in proxy|local) cat <<'EOF'
    ports:
      - "${GNOMON_BIND}:${GNOMON_PORT}:8080"
EOF
  esac
  cat <<'EOF'
    read_only: true
    tmpfs:
      - /tmp
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    logging:
      driver: json-file
      options:
        max-size: 5m
        max-file: "3"
EOF
  case "$MODE" in caddy|caddy-own) cat <<'EOF'

  caddy:
    image: caddy:2
    container_name: gnomon-caddy
    restart: unless-stopped
    depends_on:
      - gnomon
    environment:
      GNOMON_DOMAIN: ${GNOMON_DOMAIN}
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
EOF
  [ "$MODE" = caddy-own ] && cat <<'EOF'
      - ./certs:/certs:ro
EOF
  cat <<'EOF'
    logging:
      driver: json-file
      options:
        max-size: 5m
        max-file: "3"
EOF
  ;; esac
  [ "$MODE" = tunnel ] && cat <<'EOF'

  cloudflared:
    image: cloudflare/cloudflared:latest
    container_name: gnomon-cloudflared
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN}
    depends_on:
      - gnomon
    logging:
      driver: json-file
      options:
        max-size: 5m
        max-file: "3"
EOF
  cat <<'EOF'

volumes:
  gnomon-data:
EOF
  case "$MODE" in caddy|caddy-own) cat <<'EOF'
  caddy-data:
  caddy-config:
EOF
  ;; esac
} >compose.yml
chmod 644 compose.yml

case "$MODE" in
  caddy) cat >Caddyfile <<'EOF'
# Caddy gets and renews the certificate for this name from Let's Encrypt by itself.
{$GNOMON_DOMAIN} {
	encode zstd gzip
	reverse_proxy gnomon:8080
}
EOF
  ;;
  caddy-own)
    mkdir -p certs
    cp "$CERT" certs/cert.pem
    cp "$KEY" certs/key.pem
    chmod 644 certs/cert.pem
    # Caddy runs as root in its container and reads the key; nobody else on this machine needs to.
    chmod 600 certs/key.pem
    cat >Caddyfile <<'EOF'
# Your own certificate: replace certs/cert.pem and certs/key.pem before they expire, then `gnomon-admin restart`.
{$GNOMON_DOMAIN} {
	tls /certs/cert.pem /certs/key.pem
	encode zstd gzip
	reverse_proxy gnomon:8080
}
EOF
  ;;
esac
[ -f Caddyfile ] && chmod 644 Caddyfile
docker compose config --quiet || die "The generated compose.yml isn't valid (see above)"
ok "Wrote $DIR: compose.yml, .env (secret key and data key generated)$( [ -f Caddyfile ] && printf ', Caddyfile')"

# ---- 4. gnomon-admin on this machine ---------------------------------------------------------------

HERE="$(cd "$(dirname "$0")" 2>/dev/null && pwd || true)"
if [ -n "$HERE" ] && [ -f "$HERE/gnomon-admin.sh" ]; then
  cp "$HERE/gnomon-admin.sh" gnomon-admin
elif [ "$BUILD" -eq 1 ]; then
  cp source/server/deploy/gnomon-admin.sh gnomon-admin
else
  REF="main"
  [ "$VERSION" != latest ] && REF="v$VERSION"
  curl -fsSL "$RAW_BASE/$REF/server/deploy/gnomon-admin.sh" -o gnomon-admin || die "Couldn't download gnomon-admin"
fi
sed -i.bak "s|^GNOMON_DIR=.*|GNOMON_DIR=\"\${GNOMON_DIR:-$DIR}\"|" gnomon-admin && rm -f gnomon-admin.bak
chmod 755 gnomon-admin
ADMIN="$DIR/gnomon-admin"
if [ -w /usr/local/bin ]; then
  ln -sf "$DIR/gnomon-admin" /usr/local/bin/gnomon-admin
  ADMIN="gnomon-admin"
fi

# ---- 5. Start -------------------------------------------------------------------------------------

if [ "$START" -eq 0 ]; then
  say "Not started (--no-start). Start it with: cd $DIR && docker compose up -d, then $ADMIN backup-password --new and $ADMIN setup-link"
  say "The data key (GNOMON_DATA_KEY in $DIR/.env) encrypts all data: put it in your password manager, or the data is lost with it."
  exit 0
fi
if [ "$BUILD" -eq 1 ]; then
  say "Building the image (a few minutes, longer on a Raspberry Pi)…"
  docker compose build --quiet
else
  say "Getting $IMAGE…"
  # An image that only exists on this machine (loaded by hand, no registry) is fine too.
  if ! docker compose pull --quiet 2>/dev/null; then
    docker image inspect "$IMAGE" >/dev/null 2>&1 || { docker compose pull; die "Couldn't get $IMAGE"; }
    say "  (not in a registry; using the image already on this machine)"
  fi
fi
docker compose up -d

i=0
until [ "$(docker inspect -f '{{.State.Health.Status}}' gnomon 2>/dev/null)" = healthy ]; do
  i=$((i + 1))
  [ $i -gt 60 ] && { docker compose logs --tail 30 gnomon; die "The server didn't start (logs above)"; }
  sleep 2
done
SERVER_VERSION="$(docker compose exec -T gnomon gnomon-admin help 2>/dev/null | sed -n 's/^Gnomon \([^ ]*\)\. Usage.*/\1/p')"
ok "Gnomon $SERVER_VERSION is running"

if [ "$MODE" = caddy ] || [ "$MODE" = caddy-own ] || [ "$MODE" = tunnel ]; then
  say "Checking $PUBLIC_URL (a new certificate can take a minute)…"
  i=0
  until curl -fsS --max-time 10 "$PUBLIC_URL/healthz" >/dev/null 2>&1; do
    i=$((i + 1))
    if [ $i -gt 12 ]; then
      say "  $PUBLIC_URL doesn't answer yet. Check DNS, the firewall (ports 80/443) or the tunnel's public hostname;"
      say "  the setup page's address check tells you more. The server itself is running."
      break
    fi
    sleep 5
  done
  [ $i -le 12 ] && ok "HTTPS works: $PUBLIC_URL"
fi

# ---- 6. Data key, backup password and the setup link ----------------------------------------------

say ""
say "Data key (encrypts all data on disk; it's in $DIR/.env):"
say ""
say "    $DATA_KEY"
say ""
say "Put it in your password manager now. If it's lost, the data can't be read any more: only a backup and"
say "its backup password bring it back. Nobody can recover it, not even the Gnomon project."
say ""
docker compose exec -T gnomon gnomon-admin backup-password --new | sed -n '1,4p'
say "Nightly encrypted backups are on (the last 14 are kept in the data volume). A backup can only be"
say "restored with this password; nobody can recover it. Change it on the setup page if you like."
say ""
docker compose exec -T gnomon gnomon-admin setup-link
[ "$MODE" = local ] && say "(On another computer, replace localhost with this machine's address.)"
[ "$MODE" = proxy ] && say "(Point your proxy for $DOMAIN at http://${BIND:-127.0.0.1}:$PORT; until then the link won't open.)"
say ""
say "Next: open the link above (within 60 minutes) and follow the setup page. New link: $ADMIN setup-link"
say "Later: $ADMIN status | update | backup | restore | admin-link   ·   Guide: https://github.com/$REPO/blob/main/docs/admin-guide.md"
