#!/bin/sh
# Compila media/ (y libchiaki) en macOS. Uso: ./build.sh
# Dependencias: ver README. Los tres ajustes de abajo son los que hicieron falta en macOS 26 con Homebrew 7:
#  1. curl de Homebrew en vez del que trae chiaki-ng: el incluido no compila contra OpenSSL 4,
#     que es el que Homebrew deja en /opt/homebrew/include. (Mezclar cabeceras de OpenSSL 4 con
#     bibliotecas de OpenSSL 3 compila pero no enlaza.)
#  2. Python del sistema + protobuf y grpcio-tools en build/pydeps: el generador de nanopb necesita un
#     runtime de protobuf de la misma versión que su protoc, y grpcio-tools trae ambos emparejados.
#  3. El generador escribe archivos dentro del submódulo de nanopb; se limpian para no ensuciar git.
set -eu
cd "$(dirname "$0")"
BREW="$(brew --prefix)"
[ -d build/pydeps ] || /usr/bin/python3 -m pip -q install --target build/pydeps grpcio-tools protobuf
export PYTHONPATH="$PWD/build/pydeps"
cmake -S . -B build/out -DCMAKE_BUILD_TYPE=Release -DPYTHON_EXECUTABLE=/usr/bin/python3 \
  -DCHIAKI_USE_SYSTEM_CURL=ON -DCMAKE_PREFIX_PATH="$BREW/opt/curl" > build/cmake.log 2>&1
cmake --build build/out -j8 > build/make.log 2>&1 || { grep -E "error|Undefined|not found" build/make.log | head -20; exit 1; }
git -C third_party/chiaki-ng/third-party/nanopb clean -fdq generator
echo "listo: $PWD/build/out/media"
