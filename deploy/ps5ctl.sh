#!/bin/sh
# Control de los servicios. Uso: deploy/ps5ctl.sh status | logs | start | stop | restart
# status y logs no necesitan sudo; start, stop y restart sí.
set -u
CONF="$HOME/.config/ps5-stream"
LOGS="$HOME/Library/Logs/ps5-stream"
# El puerto sale de config.json (en el MacBook Pro el 8080 ya lo ocupa otra aplicación).
PORT=$(sed -n 's/.*"port"[^0-9]*\([0-9][0-9]*\).*/\1/p' "$CONF/config.json" 2>/dev/null | head -1)
PORT="${PORT:-8080}"
case "${1:-status}" in
  status)
    ok=0
    if curl -fsS -m 3 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then echo "web:   ok (puerto $PORT)"; else echo "web:   CAÍDO"; ok=1; fi
    if st=$(printf '{"op":"status"}\n' | nc -U -w 3 "$CONF/media.sock" 2>/dev/null) && [ -n "$st" ]; then echo "media: ok $st"; else echo "media: CAÍDO"; ok=1; fi
    exit $ok ;;
  logs) tail -n 40 "$LOGS/web.log" "$LOGS/media.log" ;;
  start) for n in media web; do sudo launchctl bootstrap system "/Library/LaunchDaemons/com.ps5stream.$n.plist"; done ;;
  stop) for n in web media; do sudo launchctl bootout "system/com.ps5stream.$n"; done ;;
  restart) for n in media web; do sudo launchctl kickstart -k "system/com.ps5stream.$n"; done ;;
  *) echo "Uso: $0 status | logs | start | stop | restart"; exit 2 ;;
esac
