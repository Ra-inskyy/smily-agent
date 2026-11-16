#!/bin/bash
# Re-install the smily systemd units (needed after a VM replacement wipes /etc).
# Usage: sudo ./install-units.sh  (or as root)
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cp "$DIR/run/smily-agent.service" /etc/systemd/system/smily-agent.service
cp "$DIR/run/smily-pinggy.service" /etc/systemd/system/smily-pinggy.service
systemctl daemon-reload
systemctl enable smily-agent.service smily-pinggy.service
systemctl restart smily-agent.service smily-pinggy.service
echo "installed + restarted; current URL:"
sleep 20
cat "$DIR/run/current-url.txt" 2>/dev/null || echo "(no URL yet — check /tmp/pinggy.log)"
