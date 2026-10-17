#!/bin/sh
# Takes the README screenshots with made-up demo data (scripts/demo-data.cjs) into docs/screenshots/.
# The page clock is set to a regular Wednesday, so the pictures don't depend on when you run this.
# Usage: npm run build && sh scripts/screenshots.sh
# Phone screenshots: (cd server && npm run build) && node node_modules/electron/cli.js scripts/phone-screenshots.cjs
set -e
cd "$(dirname "$0")/.."
OUT=docs/screenshots
TMP=$(mktemp -d)
mkdir -p "$OUT"

# shot <file> <view> <time> <light|dark> [extra env…]
shot() {
  file=$1 view=$2 now=$3 theme=$4
  shift 4
  rm -rf "$TMP/data"
  node scripts/demo-data.cjs "$TMP/data" "$now" en >/dev/null
  env USER_DATA_DIR="$TMP/data" FAKE_NOW="$now" CAPTURE="$OUT/$file" CAPTURE_THEME="$theme" START_VIEW="$view" CAPTURE_DELAY=2000 "$@" \
    node node_modules/electron/cli.js . >/dev/null 2>&1
  echo "✓ $OUT/$file"
}

shot morning.png today 2026-10-14T08:05:00 light
shot track.png today 2026-10-14T14:35:00 dark
shot week.png timesheet@2026-10-14 2026-10-14T14:35:00 light
shot week-day.png timesheet@2026-10-13@day 2026-10-14T14:35:00 dark
shot reports.png reports 2026-10-14T14:35:00 dark
# Dark versions for the hero shots (scripts/hero-shots.cjs)
shot morning-dark.png today 2026-10-14T08:05:00 dark
shot week-dark.png timesheet@2026-10-14 2026-10-14T14:35:00 dark
shot switcher.png today 2026-10-14T14:35:00 dark CAPTURE_QUICK=switch
mv "$OUT/switcher-quick.png" "$OUT/quick-switcher.png"
rm -f "$OUT/switcher.png"
rm -rf "$TMP"
