#!/bin/sh
# Alternativa SIN sudo a install-services.sh: registra los dos servicios como LaunchAgents del usuario actual.
# Uso: deploy/install-agents.sh [host-publico:puerto]
# Diferencia con los LaunchDaemons: arrancan cuando este usuario inicia sesión en el Mac (no antes del login)
# y corren con sus permisos. Sirve para partir en red local; para un usuario dedicado (ps5stream) usar install-services.sh.
set -eu
[ "$(id -u)" != 0 ] || { echo "Correr SIN sudo, como el usuario del servicio"; exit 1; }
PUBLIC="${1:-}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PATH="$HOME/.local/node/bin:$PATH"
NODE="$(command -v node)" || { echo "No encuentro node"; exit 1; }
[ -x "$REPO/media/build/out/media" ] || { echo "Primero corre deploy/install.sh"; exit 1; }
[ -f "$HOME/.config/ps5-stream/ps5.json" ] || { echo "Falta ps5.json: registra la PS5 primero"; exit 1; }
DOM="gui/$(id -u)"
mkdir -p "$HOME/Library/Logs/ps5-stream" "$HOME/Library/LaunchAgents"

for name in media web; do
  label="com.ps5stream.$name"
  dest="$HOME/Library/LaunchAgents/$label.plist"
  launchctl bootout "$DOM/$label" 2>/dev/null && sleep 1 || true
  # UserName solo vale para LaunchDaemons; en un LaunchAgent se quita.
  sed -e "s#__USER__#$(id -un)#g" -e "s#__HOME__#$HOME#g" -e "s#__REPO__#$REPO#g" -e "s#__NODE__#$NODE#g" -e "s#__PUBLIC__#$PUBLIC#g" \
    "$REPO/deploy/$label.plist" | grep -v '<key>UserName</key>' > "$dest"
  chmod 644 "$dest"
  launchctl bootstrap "$DOM" "$dest"
  echo "servicio $label cargado en $DOM"
done
echo "Listo. Estado: deploy/ps5ctl.sh status"
