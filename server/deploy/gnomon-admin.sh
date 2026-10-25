#!/bin/sh
# gnomon-admin on the machine that runs the Gnomon server (installed by install.sh). It runs the server's own
# gnomon-admin inside the container, and adds what only the machine can do: update, restore, logs, restart.
# See docs/admin-guide.md.
set -eu

GNOMON_DIR="${GNOMON_DIR:-/opt/gnomon}"

say() { printf '%s\n' "$*"; }
die() { printf '✗ %s\n' "$*" >&2; exit 1; }

[ -f "$GNOMON_DIR/compose.yml" ] || die "No Gnomon server in $GNOMON_DIR (set GNOMON_DIR to its folder)"
cd "$GNOMON_DIR"
dc() { docker compose "$@"; }
inner() { # the server's gnomon-admin; with a terminal when there is one (password prompts)
  if [ -t 0 ] && [ -t 1 ]; then dc exec gnomon gnomon-admin "$@"; else dc exec -T gnomon gnomon-admin "$@"; fi
}
env_get() { sed -n "s/^$1=//p" .env | tail -1; }
env_set() { # env_set NAME value: replace or add a line in .env
  if grep -q "^$1=" .env; then sed -i.bak "s|^$1=.*|$1=$2|" .env && rm -f .env.bak; else printf '%s=%s\n' "$1" "$2" >>.env; fi
}
running() { [ -n "$(dc ps -q gnomon 2>/dev/null)" ] && [ "$(docker inspect -f '{{.State.Running}}' gnomon 2>/dev/null)" = true ]; }
wait_healthy() {
  i=0
  until [ "$(docker inspect -f '{{.State.Health.Status}}' gnomon 2>/dev/null)" = healthy ]; do
    i=$((i + 1))
    [ $i -gt 60 ] && { dc logs --tail 30 gnomon; die "The server isn't healthy (logs above)"; }
    sleep 2
  done
}

usage() {
  cat <<'EOF'
Usage: gnomon-admin <command>
On this machine:
  status                 Containers, version, HTTPS, backups and disk space
  update [VERSION]       Back up, get the new version (default: the newest), restart, check
  backup [--out FILE]    Make an encrypted backup now; --out also copies it to FILE on this machine
  restore FILE|NAME      Stop the server, replace its data with a backup (asks for the backup password), start
  logs                   Follow the server's log
  restart                Restart the containers (after changing .env or the certificate)
In the server (passed on):
  setup-link · admin-link · backups · backup-password · pair · devices · revoke · add-key · help
EOF
}

cmd="${1:-help}"
[ $# -gt 0 ] && shift

case "$cmd" in
  status)
    dc ps --format 'table {{.Service}}\t{{.Status}}\t{{.Image}}'
    say ""
    if running; then inner status || true; else say "The server isn't running. Start it with: gnomon-admin restart"; fi
    url="$(env_get GNOMON_PUBLIC_URL)"
    case "$url" in
      https://*)
        if curl -fsS --max-time 10 "$url/healthz" >/dev/null 2>&1; then say "HTTPS:     $url answers"; else say "HTTPS:     $url doesn't answer from this machine"; fi
        ;;
    esac
    root="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)"
    say "Disk:      $(df -h "$root" 2>/dev/null | awk 'NR==2 {print $4 " free of " $2 " (" $1 ")"}')"
    ;;

  update)
    want="${1:-latest}"
    want="${want#v}"
    running || die "The server isn't running; start it first (gnomon-admin restart)"
    say "Backing up first…"
    if ! inner backup --label=pre-update; then
      # Without a backup password: a plain copy in the data volume, so the update never runs without one.
      stamp="$(date +%Y%m%d-%H%M%S)"
      inner backup --plain "/data/backups/gnomon-$stamp-pre-update.db" || die "The backup failed, so nothing was updated"
      say "  (no backup password set: an unencrypted copy is in the data volume; set one with gnomon-admin backup-password)"
    fi
    before="$(dc images -q gnomon 2>/dev/null | head -1)"
    if [ -d source ]; then
      # Built from the code (install.sh --build): get that version's code and build it.
      ref="main"
      [ "$want" != latest ] && ref="v$want"
      git -C source fetch --quiet --depth 1 origin "$ref" && git -C source checkout --quiet FETCH_HEAD
      dc build --quiet gnomon
    else
      image="$(env_get GNOMON_IMAGE)"
      env_set GNOMON_IMAGE "${image%:*}:$want"
      dc pull --quiet 2>/dev/null || docker image inspect "$(env_get GNOMON_IMAGE)" >/dev/null 2>&1 || die "Couldn't get $(env_get GNOMON_IMAGE)"
    fi
    dc up -d
    wait_healthy
    after="$(dc images -q gnomon 2>/dev/null | head -1)"
    [ "$before" = "$after" ] && say "Already up to date."
    inner help | head -1 | sed 's/\. Usage.*/ is running./'
    ;;

  backup)
    out=""
    [ "${1:-}" = "--out" ] && out="${2:-}" && [ -z "$out" ] && die "Usage: gnomon-admin backup --out FILE"
    if [ "${1:-}" = "--out" ]; then
      line="$(inner backup | tail -1)"
      say "$line"
      file="$(printf '%s' "$line" | sed -n 's/^Backed up to \([^ ]*\) .*/\1/p')"
      [ -n "$file" ] || die "Couldn't tell which file was made"
      dc cp "gnomon:$file" "$out" >/dev/null 2>&1 || die "Couldn't copy $file to $out"
      chmod 600 "$out"
      say "Copied to $out (encrypted; restore needs the backup password)"
    else
      inner backup "$@"
    fi
    ;;

  restore)
    src="${1:-}"
    [ -n "$src" ] || die "Usage: gnomon-admin restore FILE (a .gnomonbak on this machine) or NAME (from gnomon-admin backups)"
    tmpdir=""
    if [ -f "$src" ]; then
      # A readable copy for the container's unprivileged user (the file is encrypted, so that's fine).
      tmpdir="$(mktemp -d)"
      cp "$src" "$tmpdir/restore.gnomonbak"
      chmod 755 "$tmpdir"
      chmod 644 "$tmpdir/restore.gnomonbak"
      mount="-v $tmpdir/restore.gnomonbak:/restore.gnomonbak:ro"
      target=/restore.gnomonbak
    else
      mount=""
      target="/data/backups/$(basename "$src")"
    fi
    say "This stops the server and replaces all its data with the backup. The current data is kept next to it."
    if [ -t 0 ]; then
      printf 'Type "restore" to go on: '
      read -r answer
      [ "$answer" = restore ] || die "Nothing changed"
    fi
    dc stop gnomon
    tty=""
    [ -t 0 ] || tty="-T"
    # shellcheck disable=SC2086 # $mount and $tty are option lists
    if dc run --rm --no-deps $tty $mount gnomon gnomon-admin restore "$target"; then
      [ -n "$tmpdir" ] && rm -rf "$tmpdir"
      dc up -d
      wait_healthy
      say "Restored, and the server is running again."
    else
      [ -n "$tmpdir" ] && rm -rf "$tmpdir"
      dc up -d
      die "Restoring didn't work (see above); the server runs on with its data as before."
    fi
    ;;

  logs) dc logs --tail 100 -f gnomon ;;
  restart) dc up -d --force-recreate && wait_healthy && say "Restarted." ;;
  help|-h|--help) usage ;;
  *) inner "$cmd" "$@" ;;
esac
