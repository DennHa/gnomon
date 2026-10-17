#!/bin/sh
# Run before pushing: fails if anything that would be committed looks like a secret, personal data or a private address.
# Usage: sh scripts/check-public.sh
cd "$(dirname "$0")/.." || exit 1
files=$(git ls-files --cached --others --exclude-standard)
fail=0

# Files that must never be in the repo
bad=$(printf '%s\n' "$files" | grep -E '(^|/)(\.env(\..*)?|data\.json|trail\.json|api-key\.json|float-token\.json|personio-credentials\.json)$|\.(db|sqlite3?|pem|key|p12|dmg)$')
[ -n "$bad" ] && { echo "✗ Files that must not be published:"; echo "$bad"; fail=1; }

# Content: private IPs, home paths, real keys, private keys, real hostnames
pattern='192\.168\.[0-9]+\.[0-9]+|10\.[0-9]+\.[0-9]+\.[0-9]+|/Users/[a-z]|(gnomon|punch)_[A-Za-z0-9_-]{16,}|BEGIN [A-Z ]*PRIVATE KEY|ghp_[A-Za-z0-9]{20,}|xox[bp]-|AKIA[0-9A-Z]{16}|ts\.net'
hits=$(printf '%s\n' "$files" | grep -v -E '(^|/)package-lock\.json$|^scripts/check-public\.sh$' | while read -r f; do
  [ -f "$f" ] && grep -I -n -E "$pattern" "$f" /dev/null 2>/dev/null
done)
[ -n "$hits" ] && { echo "✗ Content that looks private:"; echo "$hits"; fail=1; }

# Personal words (your name, home domain…) live in .private-patterns, which is never committed: one regex per line.
if [ -f .private-patterns ]; then
  personal=$(grep -v -E '^\s*(#|$)' .private-patterns | paste -sd'|' -)
  if [ -n "$personal" ]; then
    phits=$(printf '%s\n' "$files" | grep -v -E '(^|/)package-lock\.json$|^\.private-patterns$' | while read -r f; do
      [ -f "$f" ] && grep -I -n -i -E "$personal" "$f" /dev/null 2>/dev/null
    done)
    [ -n "$phits" ] && { echo "✗ Personal details:"; echo "$phits"; fail=1; }
  fi
fi

[ $fail -eq 0 ] && echo "✓ Nothing private found in $(printf '%s\n' "$files" | wc -l | tr -d ' ') files."
exit $fail
