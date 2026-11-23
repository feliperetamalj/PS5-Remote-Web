# PS5 Remote Web

Juega la PS5 de Felipe desde Chrome, con tu propio mando (PS4, PS5 o Xbox). Uso privado entre amigos: cuentas aprobadas a mano, reservas por hora, lista de espera y fila en vivo.

- Arquitectura y decisiones: [`docs/decisiones.md`](docs/decisiones.md)
- Seguridad: [`docs/seguridad.md`](docs/seguridad.md)
- Latencias medidas: [`docs/mediciones.md`](docs/mediciones.md)
- Roadmap y estado: [`docs/roadmap.md`](docs/roadmap.md)

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

| Para compilar `media/` | `brew install cmake pkg-config opus openssl@3 json-c miniupnpc libevent python` | libchiaki y libdatachannel |
| Para probar | `brew install ffmpeg gh` | `ffplay` para ver el `.h264`; `gh` para GitHub |

Diseño: estilo "cosmic" (catálogo design-styles), componentes copiados de [motion-primitives](https://github.com/ibelick/motion-primitives) en `web/client/src/motion/`, Chart.js en el panel y la fuente Audiowide servida desde el propio sitio.

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
