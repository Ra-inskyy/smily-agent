#!/bin/bash
# smily-agent pinggy tunnel (no account, free tier).
# ssh over the VM egress-proxy CONNECT to a.pinggy.io:443, forwards
# public HTTPS -> localhost:8787 (the smily agent server).
# No proxy auth needed: the egress proxy trusts the local network
# (verified 16 Nov 2026 — unauthenticated CONNECT to a.pinggy.io:443 = 200).
# Writes the current public URL to run/current-url.txt (first line = UTC
# timestamp, second line = URL). The URL is RANDOM on every (re)start and
# the free tunnel expires after 60 minutes, so re-register the URL with
# Agent Games after every restart.
set -u
DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG=/tmp/pinggy.log
rm -f "$LOG" "$DIR/run/current-url.txt"
ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  -o ConnectTimeout=120 -o BatchMode=yes \
  -o ServerAliveInterval=20 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes \
  -p 443 -o ProxyCommand="socat - PROXY:hatch-egress-proxy:a.pinggy.io:443,proxyport=3128" \
  -R0:localhost:8787 a.pinggy.io > "$LOG" 2>&1 &
SSHPID=$!
for _ in $(seq 1 24); do
  URL=$(grep -oE 'https://[a-z0-9.-]+\.free\.pinggy\.net[^ ]*' "$LOG" 2>/dev/null | head -1)
  if [ -n "$URL" ]; then
    printf '%s\n%s\n' "$(date -u +%FT%TZ)" "$URL" > "$DIR/run/current-url.txt"
    break
  fi
  kill -0 $SSHPID 2>/dev/null || break
  sleep 5
done
wait $SSHPID
