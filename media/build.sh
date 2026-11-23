#!/bin/sh
# Compila media/ (y libchiaki) en macOS. Uso: ./build.sh
# Dependencias: ver README. Los tres ajustes de abajo son los que hicieron falta en macOS 26 con Homebrew 7:
#  1. curl de Homebrew en vez del que trae chiaki-ng: el incluido no compila contra OpenSSL 4,
#     que es el que Homebrew deja en /opt/homebrew/include. (Mezclar cabeceras de OpenSSL 4 con
#     bibliotecas de OpenSSL 3 compila pero no enlaza.)
#  2. Python del sistema + protobuf y grpcio-tools en build/pydeps: el generador de nanopb necesita un
#     runtime de protobuf de la misma versión que su protoc, y grpcio-tools trae ambos emparejados.
#  3. El generador escribe archivos dentro del submódulo de nanopb; se limpian para no ensuciar git.
#  4. Macs Intel: Homebrew ya no publica binarios para Intel, así que las dependencias se compilan con
#     deploy/toolchain-intel.sh en ~/ps5-toolchain (sin sudo). Si esa carpeta existe se usa en vez de
#     Homebrew. Ahí OpenSSL es de la serie 3, por lo que sirve el curl que trae chiaki-ng (ajuste 1 no aplica).
set -eu
cd "$(dirname "$0")"
TC="${PS5_TOOLCHAIN:-$HOME/ps5-toolchain}"
if [ -d "$TC/prefix" ]; then
  export PATH="$TC/prefix/bin:$TC/py/bin:$PATH" PKG_CONFIG_PATH="$TC/prefix/lib/pkgconfig"
  PY="$TC/py/bin/python"   # ya trae grpcio-tools y protobuf (ajuste 2)
  DEPS="-DCHIAKI_USE_SYSTEM_CURL=OFF -DCMAKE_PREFIX_PATH=$TC/prefix -DOPENSSL_ROOT_DIR=$TC/prefix -DOPENSSL_USE_STATIC_LIBS=ON"
else
  DEPS="-DCHIAKI_USE_SYSTEM_CURL=ON -DCMAKE_PREFIX_PATH=$(brew --prefix)/opt/curl"
  PY=/usr/bin/python3
  [ -d build/pydeps ] || /usr/bin/python3 -m pip -q install --target build/pydeps grpcio-tools protobuf
  export PYTHONPATH="$PWD/build/pydeps"
fi
mkdir -p build
cmake -S . -B build/out -DCMAKE_BUILD_TYPE=Release -DPYTHON_EXECUTABLE="$PY" \
  $DEPS > build/cmake.log 2>&1 || { tail -20 build/cmake.log; exit 1; }
cmake --build build/out -j"${PS5_JOBS:-8}" > build/make.log 2>&1 || { grep -E "error|Undefined|not found" build/make.log | head -20; exit 1; }
git -C third_party/chiaki-ng/third-party/nanopb clean -fdq generator
echo "listo: $PWD/build/out/media"
