#!/bin/sh
# Registra los dos servicios en launchd para que arranquen con el Mac y se reinicien si caen.
# Uso: sudo deploy/install-services.sh <usuario-del-servicio>
# Es el único paso que necesita sudo. Solo escribe dos archivos en /Library/LaunchDaemons.
set -eu
[ "$(id -u)" = 0 ] || { echo "Correr con sudo"; exit 1; }
SVC_USER="${1:?Uso: sudo deploy/install-services.sh <usuario>}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SVC_HOME="$(dscl . -read "/Users/$SVC_USER" NFSHomeDirectory | awk '{print $2}')"
NODE="$(sudo -u "$SVC_USER" sh -lc 'command -v node')"
[ -x "$REPO/media/build/out/media" ] || { echo "Primero corre deploy/install.sh como $SVC_USER"; exit 1; }
sudo -u "$SVC_USER" mkdir -p "$SVC_HOME/Library/Logs/ps5-stream"

for name in media web; do
  label="com.ps5stream.$name"
  dest="/Library/LaunchDaemons/$label.plist"
  launchctl bootout "system/$label" 2>/dev/null || true
  sed -e "s#__USER__#$SVC_USER#g" -e "s#__HOME__#$SVC_HOME#g" -e "s#__REPO__#$REPO#g" -e "s#__NODE__#$NODE#g" \
    "$REPO/deploy/$label.plist" > "$dest"
  chown root:wheel "$dest" && chmod 644 "$dest"
  launchctl bootstrap system "$dest"
  echo "servicio $label cargado"
done
echo "Listo. Estado: deploy/ps5ctl.sh status"
