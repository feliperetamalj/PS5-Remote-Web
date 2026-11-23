# PS5 Remote Web

Juega la PS5 de Felipe desde Chrome, con tu propio mando (PS4, PS5 o Xbox). Uso privado entre amigos: cuentas aprobadas a mano, reservas por hora, lista de espera y fila en vivo.

- Arquitectura y decisiones: [`docs/decisiones.md`](docs/decisiones.md)
- Seguridad: [`docs/seguridad.md`](docs/seguridad.md)
- Latencias medidas: [`docs/mediciones.md`](docs/mediciones.md)
- Roadmap y estado: [`docs/roadmap.md`](docs/roadmap.md)
- Despliegue: [`docs/HANDOFF_OPENCLAW.md`](docs/HANDOFF_OPENCLAW.md) y [`docs/DEPLOY_OPENCLAW.md`](docs/DEPLOY_OPENCLAW.md)

```
PS5 ──Remote Play (LAN)──► media/ (C++: libchiaki + libdatachannel) ──WebRTC UDP──► Chrome
                               ▲ socket unix
                           web/ (Node 24 + Hono + SQLite) ◄──HTTPS (playit.gg)── Chrome
```

## Dependencias

| Qué | Comando | Para qué |
|---|---|---|
| Node 24+ | `brew install node` | Servidor web y build del frontend |
| Paquetes npm | `cd web && npm ci` | Ver `web/package.json` |

| Para compilar `media/` | `brew install cmake pkg-config protobuf curl opus json-c miniupnpc libevent` | libchiaki (el script instala además `grpcio-tools` y `protobuf` de Python en `media/build/pydeps`) |
| Para probar | `brew install ffmpeg gh` | `ffplay` para ver el `.h264`; `gh` para GitHub |

Diseño: estilo "cosmic" (catálogo design-styles), componentes copiados de [motion-primitives](https://github.com/ibelick/motion-primitives) en `web/client/src/motion/`, Chart.js en el panel y la fuente Audiowide servida desde el propio sitio.

## Streaming (`media/`)

```bash
git submodule update --init --recursive
media/build.sh
media/build/out/media discover 192.168.100.44   # estado de la PS5
media/build/out/media register 192.168.100.44 <id-de-cuenta> <pin> ~/.config/ps5-stream/ps5.json
media/build/out/media serve ~/.config/ps5-stream/ps5.json ~/.config/ps5-stream/media.sock 50000   # servidor de streaming
media/build/out/media dump ~/.config/ps5-stream/ps5.json prueba.h264 10 --press-x   # y luego: ffplay prueba.h264
```

chiaki-ng está fijado en la versión v1.10.1. Los ajustes que hicieron falta para compilar en macOS 26 están comentados en `media/build.sh`.

## Desarrollo

```bash
cp config.example.json config.dev.json   # editar y luego: chmod 600 config.dev.json
cd web && npm ci
PS5_CONFIG=../config.dev.json npm run admin:create -- tu@email.cl "Felipe"
PS5_CONFIG=../config.dev.json npm run dev
npm test
```

## Licencia

AGPL-3.0, porque `media/` enlaza libchiaki (chiaki-ng, AGPL-3.0). El código fuente se enlaza desde el pie de página.
