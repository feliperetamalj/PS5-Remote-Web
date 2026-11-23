#!/bin/sh
# Dependencias de compilación SIN Homebrew ni sudo, para Macs Intel.
# Motivo: Homebrew dejó de publicar binarios para macOS Intel (solo arm64), así que "brew install"
# compilaría node, cmake y protobuf desde el código durante horas. Este script deja todo lo necesario
# en una carpeta del usuario (por defecto ~/ps5-toolchain) y no toca nada del sistema.
# Uso: deploy/toolchain-intel.sh     (idempotente: lo que ya está compilado se salta)
# Para borrar todo: rm -rf ~/ps5-toolchain
set -eu
TC="${PS5_TOOLCHAIN:-$HOME/ps5-toolchain}"
P="$TC/prefix"
J="${PS5_JOBS:-6}"   # deja núcleos libres para lo demás que corre en el Mac
mkdir -p "$TC/src" "$P/bin" "$P/lib/pkgconfig"
export PATH="$P/bin:$TC/py/bin:$PATH"
export PKG_CONFIG_PATH="$P/lib/pkgconfig"
export MACOSX_DEPLOYMENT_TARGET=13.0

# cmake: binario oficial empaquetado en PyPI, dentro de un entorno virtual propio.
[ -x "$TC/py/bin/cmake" ] || { /usr/bin/python3 -m venv "$TC/py"; "$TC/py/bin/pip" -q install --upgrade pip; "$TC/py/bin/pip" -q install cmake; }

# protoc: chiaki-ng lo busca en el PATH. grpcio-tools trae uno emparejado con su runtime de protobuf,
# que es justo lo que necesita el generador de nanopb; se expone con un envoltorio.
if [ ! -x "$P/bin/protoc" ]; then
  "$TC/py/bin/pip" -q install grpcio-tools protobuf
  printf '#!/bin/sh\nexec "%s/py/bin/python" -m grpc_tools.protoc "$@"\n' "$TC" > "$P/bin/protoc"
  chmod +x "$P/bin/protoc"
fi

get() { # get <nombre> <url>: descarga y descomprime en src/<nombre>
  [ -d "$TC/src/$1" ] && return 0
  echo "  descargando $1"
  mkdir -p "$TC/src/$1.tmp"
  curl -fsSL "$2" | tar -xz -C "$TC/src/$1.tmp" --strip-components 1
  mv "$TC/src/$1.tmp" "$TC/src/$1"
}
step() { echo "== $1"; }

if [ ! -x "$P/bin/pkg-config" ]; then
  step "pkgconf 2.3.0"
  get pkgconf https://distfiles.ariadne.space/pkgconf/pkgconf-2.3.0.tar.gz
  (cd "$TC/src/pkgconf" && ./configure --prefix="$P" --disable-shared --with-pkg-config-dir="$P/lib/pkgconfig" >/dev/null && make -j"$J" >/dev/null && make install >/dev/null)
  ln -sf pkgconf "$P/bin/pkg-config"
fi

if [ ! -f "$P/lib/libcrypto.a" ]; then
  step "OpenSSL 3.5.4 (LTS; con la serie 3 compila el curl que trae chiaki-ng)"
  get openssl https://github.com/openssl/openssl/releases/download/openssl-3.5.4/openssl-3.5.4.tar.gz
  (cd "$TC/src/openssl" && ./Configure darwin64-x86_64-cc no-shared no-tests no-docs --prefix="$P" --libdir=lib --openssldir=/etc/ssl >/dev/null && make -j"$J" >/dev/null 2>&1 && make install_sw >/dev/null 2>&1)
fi

if [ ! -f "$P/lib/libopus.a" ]; then
  step "opus 1.5.2"
  get opus https://downloads.xiph.org/releases/opus/opus-1.5.2.tar.gz
  (cd "$TC/src/opus" && ./configure --prefix="$P" --disable-shared --disable-doc --disable-extra-programs >/dev/null && make -j"$J" >/dev/null && make install >/dev/null)
fi

if [ ! -f "$P/lib/libjson-c.a" ]; then
  step "json-c 0.18"
  get json-c https://s3.amazonaws.com/json-c_releases/releases/json-c-0.18.tar.gz
  cmake -S "$TC/src/json-c" -B "$TC/src/json-c/_b" -DCMAKE_INSTALL_PREFIX="$P" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DBUILD_TESTING=OFF -DBUILD_APPS=OFF -DCMAKE_POLICY_VERSION_MINIMUM=3.5 >/dev/null
  cmake --build "$TC/src/json-c/_b" -j"$J" >/dev/null && cmake --install "$TC/src/json-c/_b" >/dev/null
fi

if [ ! -f "$P/lib/libminiupnpc.a" ]; then
  step "miniupnpc 2.2.8"
  get miniupnp https://github.com/miniupnp/miniupnp/archive/refs/tags/miniupnpc_2_2_8.tar.gz
  cmake -S "$TC/src/miniupnp/miniupnpc" -B "$TC/src/miniupnp/_b" -DCMAKE_INSTALL_PREFIX="$P" -DCMAKE_BUILD_TYPE=Release -DUPNPC_BUILD_SHARED=OFF -DUPNPC_BUILD_TESTS=OFF -DUPNPC_BUILD_SAMPLE=OFF -DCMAKE_POLICY_VERSION_MINIMUM=3.5 >/dev/null
  cmake --build "$TC/src/miniupnp/_b" -j"$J" >/dev/null && cmake --install "$TC/src/miniupnp/_b" >/dev/null
fi

if [ ! -f "$P/lib/libevent.a" ]; then
  step "libevent 2.1.12"
  get libevent https://github.com/libevent/libevent/releases/download/release-2.1.12-stable/libevent-2.1.12-stable.tar.gz
  (cd "$TC/src/libevent" && ./configure --prefix="$P" --disable-shared --disable-openssl --disable-samples --disable-libevent-regress >/dev/null && make -j"$J" >/dev/null 2>&1 && make install >/dev/null)
fi

echo "toolchain listo en $P"
for m in openssl opus json-c miniupnpc libevent; do printf '  %-10s %s\n' "$m" "$(pkg-config --modversion "$m" 2>/dev/null || echo FALTA)"; done
