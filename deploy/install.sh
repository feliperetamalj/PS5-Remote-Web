#!/bin/sh
# Instala o actualiza PS5 Remote Web en este Mac. Es idempotente: se puede correr de nuevo tras cada `git pull`.
# Se corre SIN sudo, como el usuario que va a ejecutar el servicio, desde cualquier carpeta.
# No toca nada fuera del repo, de ~/.config/ps5-stream y de ~/.local/share/ps5-stream.
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
CONF="$HOME/.config/ps5-stream"

for tool in brew node npm cmake git; do
  command -v "$tool" >/dev/null || { echo "Falta '$tool'. Ver la tabla de dependencias en README.md"; exit 1; }
done
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' || { echo "Se necesita Node 24 o superior"; exit 1; }

echo "1/4 submódulos"
git -C "$REPO" submodule update --init --recursive

echo "2/4 servidor de streaming (la primera vez tarda varios minutos)"
"$REPO/media/build.sh"

echo "3/4 servidor web"
(cd "$REPO/web" && npm ci --no-audit --no-fund && npm run build)

echo "4/4 configuración"
mkdir -p "$CONF" && chmod 700 "$CONF"
if [ ! -f "$CONF/config.json" ]; then
  cp "$REPO/config.example.json" "$CONF/config.json"
  echo "  Creado $CONF/config.json: revisa public_origin"
fi
chmod 600 "$CONF/config.json"
[ -f "$CONF/ps5.json" ] || echo "  Falta $CONF/ps5.json (claves de la PS5): ver docs/DEPLOY_OPENCLAW.md, paso 4"

(cd "$REPO/web" && npm test >/dev/null 2>&1) && echo "pruebas: ok" || { echo "pruebas: FALLARON (cd web && npm test)"; exit 1; }
echo "Instalación lista. Sigue con: sudo deploy/install-services.sh $(id -un)"
