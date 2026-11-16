#!/bin/bash
# smily-agent watchdog — run every 5 min from cron (fresh runtime env each run,
# which is the ONLY way to get a fresh egress-proxy credential for the tunnel).
# 1. Ensures smily-agent.service (node server :8787) is running.
# 2. Ensures a pinggy tunnel is alive AND its public URL answers /health.
#    If not, starts a new tunnel with the current $https_proxy credential,
#    waits up to ~100s for the public URL, writes run/current-url.txt.
# The public URL is RANDOM on every tunnel start and the free tunnel expires
# after 60 minutes — re-register the URL with Agent Games after each change.
set -u
DIR="$(cd "$(dirname "$0")/.." && pwd)"
URLFILE="$DIR/run/current-url.txt"
LOG=/tmp/smily-watchdog.log
say() { echo "$(date -u +%FT%TZ) $*" >> "$LOG"; }

systemctl is-active -q smily-agent.service || { systemctl start smily-agent.service; say "server restarted"; sleep 3; }
curl -fs -m 5 http://127.0.0.1:8787/health >/dev/null 2>&1 || { say "local /health DOWN"; exit 1; }

# Is there a live tunnel whose URL answers?
if [ -f "$URLFILE" ]; then
  URL=$(sed -n '2p' "$URLFILE")
  if [ -n "$URL" ] && curl -fs -m 15 -H "X-Pinggy-No-Screen: true" "$URL/health" >/dev/null 2>&1; then
    exit 0
  fi
  say "public URL unhealthy/missing: ${URL:-none}"
fi

# Kill any stale tunnel ssh (by exact PID file if present, else pattern on the ssh cmdline).
# NOTE: this script's own cmdline never contains the pattern, so pgrep is safe here.
STALE=$(pgrep -f 'ssh -o StrictHostKeyChecking=no.*a\.pinggy\.io' || true)
[ -n "$STALE" ] && { echo "$STALE" | xargs -r kill 2>/dev/null; sleep 2; say "killed stale tunnel: $STALE"; }

auth="${https_proxy#http://}"; auth="${auth%@*}"
rm -f /tmp/pinggy.log "$URLFILE"
setsid nohup ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  -o ConnectTimeout=60 -o BatchMode=yes \
  -o ServerAliveInterval=20 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes \
  -p 443 -o ProxyCommand="socat - PROXY:hatch-egress-proxy:a.pinggy.io:443,proxyport=3128,proxyauth=$auth" \
  -R0:localhost:8787 a.pinggy.io > /tmp/pinggy.log 2>&1 < /dev/null &
for _ in $(seq 1 20); do
  sleep 5
  URL=$(grep -oE 'https://[a-z0-9.-]+\.free\.pinggy\.net[^ ]*' /tmp/pinggy.log 2>/dev/null | head -1)
  if [ -n "$URL" ]; then
    printf '%s\n%s\n' "$(date -u +%FT%TZ)" "$URL" > "$URLFILE"
    if curl -fs -m 15 -H "X-Pinggy-No-Screen: true" "$URL/health" >/dev/null 2>&1; then
      say "tunnel UP: $URL"
      exit 0
    fi
    say "tunnel URL found but /health failed: $URL"
  fi
done
say "tunnel FAILED to come up; see /tmp/pinggy.log"
exit 1
