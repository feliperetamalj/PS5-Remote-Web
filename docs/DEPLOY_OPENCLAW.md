# Despliegue en el servidor (runbook para OpenClaw)

Este documento es para el agente OpenClaw que corre en el MacBook Pro Intel 2019 de Felipe (usuario `elepew`). Objetivo: dejar PS5 Remote Web corriendo en ese Mac como servicio, primero solo dentro de la red de la casa.

## Reglas

- **No tocar** `~/Server` (Minecraft), la configuración de OpenClaw ni ningún servicio que ya exista en el Mac.
- **No detener nada.** Si la compilación compite por CPU con el servidor de Minecraft, avisarle a Felipe en vez de parar algo.
- **Nunca** subir al repo ni mostrar en un mensaje el contenido de `~/.config/ps5-stream/` (claves de la PS5 y configuración).
- Los pasos marcados **[Felipe]** necesitan su contraseña o una decisión suya: pedírselos y esperar. No intentar resolverlos de otra forma.
- Si un paso falla, parar ahí y reportar el comando y las últimas 20 líneas de salida. No improvisar arreglos fuera del repo.
- No abrir puertos en el router ni cambiar el firewall: eso es de la etapa 2 y lo decide Felipe.

## Qué se instala

| Proceso | Qué hace | Escucha en |
|---|---|---|
| `web` (Node 24) | Página, cuentas, reservas, admin, señalización | `127.0.0.1:8080` (solo local) |
| `media` (C++) | Sesión de Remote Play con la PS5 y video por WebRTC | Socket unix `~/.config/ps5-stream/media.sock` y UDP 50000 |

Archivos fuera del repo: `~/.config/ps5-stream/` (configuración y claves, permisos 700/600), `~/.local/share/ps5-stream/` (base de datos) y `~/Library/Logs/ps5-stream/` (logs).

## Pasos

### 1. Usuario del servicio **[Felipe]**

El servicio debe correr con un usuario sin privilegios, para que no pueda leer el resto del Mac. Felipe lo crea en Ajustes del Sistema → Usuarios y grupos → Añadir usuario, de tipo **Estándar**, con nombre de cuenta `ps5stream`.

Si Felipe prefiere partir con `elepew` para la prueba en red local, se puede: todos los pasos funcionan igual cambiando el usuario. Queda anotado como pendiente obligatorio antes de abrir a internet.

Los pasos 2 a 4 se corren **como ese usuario** (por ejemplo `sudo -iu ps5stream`, que pide la contraseña de Felipe).

### 2. Dependencias

Homebrew ya debería estar en el Mac. Comprobar e instalar lo que falte:

```bash
brew install node cmake pkg-config protobuf curl opus json-c miniupnpc libevent
node --version   # debe ser 24 o superior
```

En Intel, Homebrew vive en `/usr/local`. Si el usuario del servicio no encuentra `brew` o `node`, agregar `/usr/local/bin` a su PATH.

**MacBook Pro Intel (lo que se usó de verdad, 2026-11-22):** el Mac no tenía Homebrew, y Homebrew ya no publica binarios para macOS Intel (solo arm64), así que `brew install` compilaría todo desde el código. En su lugar:

```bash
deploy/toolchain-intel.sh   # sin sudo; deja cmake, pkgconf, protoc, OpenSSL 3.5.4, opus 1.5.2, json-c 0.18, miniupnpc 2.2.8 y libevent 2.1.12 en ~/ps5-toolchain
```

- Tarda unos 6 minutos con 6 hilos. `media/build.sh` e `install.sh` detectan `~/ps5-toolchain` y lo usan en vez de Homebrew.
- Node 24 ya estaba en `~/.local/node/bin` (v24.21.0); `install.sh` e `install-services.sh` lo buscan ahí.
- Las bibliotecas van enlazadas estáticamente: el binario `media` solo depende de bibliotecas del sistema.
- Para deshacerlo: `rm -rf ~/ps5-toolchain`.

**Puerto:** en este Mac el `8080` ya lo usa otra aplicación (`~/Apps/disco`). Se usa **`8091`** en `config.json`; `ps5ctl.sh` lee el puerto de ahí. Donde este documento diga `8080`, en el MacBook Pro es `8091` (también el destino del túnel HTTPS de playit).

### 3. Código e instalación

```bash
git clone --recurse-submodules git@github.com:feliperetamalj/PS5-Remote-Web.git ~/ps5-remote-web
~/ps5-remote-web/deploy/install.sh
```

`install.sh` es idempotente. Compila `media` (varios minutos la primera vez), instala y compila `web`, corre las pruebas y crea `~/.config/ps5-stream/config.json` desde el ejemplo.

**Riesgo conocido:** la compilación se validó en un Mac con Apple Silicon y macOS 26, donde hicieron falta tres ajustes que están comentados en `media/build.sh` (OpenSSL 4, curl de Homebrew y el generador de protobuf). En Intel puede aparecer otro. Si falla, el detalle queda en `media/build/cmake.log` y `media/build/make.log`: reportar las líneas con `error` y no editar el código de `media/third_party/`.

### 4. Configuración y claves de la PS5

1. Editar `~/.config/ps5-stream/config.json`:
   - `public_origin`: la dirección exacta con la que se abre la página, sin barra final. Con el túnel de playit es `https://ps5remote.felipardo.cl`.
   - Dejar `port` en 8080.
2. Claves de la PS5 (`~/.config/ps5-stream/ps5.json`) **[Felipe]**. Dos caminos:
   - Copiar el archivo desde el Mac de desarrollo de Felipe (`~/.config/ps5-stream/ps5.json`) y dejarlo con `chmod 600`.
   - O registrar de nuevo. Felipe saca un PIN en la PS5 (Ajustes → Sistema → Uso a distancia → Vincular dispositivo) y se corre:
     ```bash
     ~/ps5-remote-web/media/build/out/media register 192.168.100.44 <id-de-cuenta> <pin> ~/.config/ps5-stream/ps5.json
     ```
3. Comprobar que la consola responde:
   ```bash
   ~/ps5-remote-web/media/build/out/media discover 192.168.100.44
   ```
   Debe decir `estado: ready` (o `standby` si está en reposo).

### 5. Servicios **[Felipe: sudo]**

```bash
sudo ~/ps5-remote-web/deploy/install-services.sh ps5stream
```

Escribe `/Library/LaunchDaemons/com.ps5stream.media.plist` y `com.ps5stream.web.plist`, y los carga. Arrancan con el Mac y se reinician solos si caen.

### 6. Cuenta de administrador **[Felipe]**

Como el usuario del servicio, y con Felipe escribiendo la contraseña:

```bash
cd ~/ps5-remote-web/web
PS5_CONFIG=~/.config/ps5-stream/config.json npm run admin:create -- <correo-de-felipe> "Felipe"
```

### 7. Túnel de playit.gg y Caddy local

Felipe ya creó en playit.gg el túnel web con el dominio `ps5remote.felipardo.cl` (tunnel_id 5167769).

**Corrección (2026-11-23):** este túnel **no termina el HTTPS**. Pasa TCP crudo: el puerto 80 público va a un puerto local y el 443 público a otro, igual que el túnel de Wii Sports. Por eso hace falta un Caddy local que saque el certificado y hable HTTPS. La versión anterior de este paso ("no instalar certificados ni proxies") estaba equivocada para este Mac.

| Público | Destino local | Quién escucha |
|---|---|---|
| `ps5remote.felipardo.cl:80` | `127.0.0.1:8462` | Caddy (redirige a HTTPS y responde el desafío de Let's Encrypt) |
| `ps5remote.felipardo.cl:443` | `127.0.0.1:8461` | Caddy (HTTPS) → `reverse_proxy 127.0.0.1:8091` |

- No se usan los puertos 80 y 443 locales: el 443 lo ocupa Tailscale. El 8451 es de otro Caddy y el 8452 de Tailscale; no reutilizarlos.
- Caddy va **fuera del repo**: configuración en `~/.config/ps5-stream/caddy/Caddyfile` (certificados en `~/.config/ps5-stream/caddy/data`), binario `~/Apps/disco/bin/caddy`, LaunchAgent `~/Library/LaunchAgents/cl.ps5remote.caddy.plist` y logs en `~/Library/Logs/ps5-stream/caddy*.log`.
- **Orden:** primero se cambian en el panel de playit los dos destinos locales (HTTP → 8462, HTTPS → 8461) y recién después se arranca Caddy. Si Caddy parte antes, falla el desafío y gasta intentos de Let's Encrypt.
  ```bash
  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/cl.ps5remote.caddy.plist
  ```
- `web` sigue hablando HTTP solo en `127.0.0.1:8091`. `public_origin` en `config.json` debe ser exactamente `https://ps5remote.felipardo.cl`; si no coincide, la página carga pero todo intento de entrar responde "Origen no permitido".
- No modificar los túneles que ya existan (Minecraft, Wii Sports y el resto).

Comprobación: `curl -sI https://ps5remote.felipardo.cl/api/health` responde `200` y trae la cabecera `content-security-policy`.

**Estado al 2026-11-23 00:15:** Caddyfile y LaunchAgent creados, Caddy **detenido**. El túnel todavía apunta a `127.0.0.1:443` (playit registra timeouts); falta el cambio en el panel.

**Pendiente:** como el túnel es TCP crudo, Caddy ve llegar las conexiones desde el agente de playit y no desde el visitante. Falta verificar si playit puede entregar la IP real (por ejemplo con PROXY protocol); mientras tanto los límites de intentos de login no distinguen por IP.

Desde que este paso funciona, la página de acceso queda visible en internet: el paso 6 (admin con contraseña fuerte) va antes.

### 8. Video desde fuera de la casa (etapa 2, solo cuando Felipe lo pida)

La conexión de Felipe tiene indicios de CGNAT, así que el video de quienes juegan desde fuera entra por un **túnel UDP de playit.gg** (hay nodo en Chile; el túnel web medía 6 ms desde la casa).

1. Túnel UDP "PS5 Remote Web UDP", ya creado por Felipe: dirección pública **`wap-autumn.tun.ply.gg:1887`**.
2. Su destino local debe ser `127.0.0.1`, puerto **`50000`**. Playit lo creó apuntando a `24642`: hay que cambiarlo en el panel, porque `media` escucha en el 50000.
3. Reinstalar los servicios con la dirección pública:
   ```bash
   sudo ~/ps5-remote-web/deploy/install-services.sh elepew wap-autumn.tun.ply.gg:1887
   ```
   Los servicios están instalados como LaunchDaemons, así que este paso pide `sudo` (Felipe). Usar `install-agents.sh` aquí dejaría dos copias de cada servicio peleando por los mismos puertos.
4. `tail ~/Library/Logs/ps5-stream/media.log` debe decir `público <ip>:<puerto>`.

En ese modo el servidor anuncia solo la dirección del túnel y deja de compartir las IP locales del Mac. Los que juegan dentro de la casa también pasan por el túnel.

El registro de Remote Play ya está hecho con la cuenta PSN de invitados (`felipardo777web`, 2026-11-22), así que ese requisito de `docs/seguridad.md` está cumplido. No hace falta otro PIN.

**Permiso de Red local de macOS:** `media` necesita llegar a la PS5 por la red de la casa. Lanzado por launchd y sin firma, macOS se lo niega sin avisar (`No route to host`). `media/build.sh` firma el binario con el identificador `cl.felipardo.ps5stream.media`; la primera vez hay que aceptar en pantalla "¿Permitir que … busque dispositivos en las redes locales?". Si tras recompilar vuelve el error, revisar Ajustes del Sistema → Privacidad y seguridad → Red local.

### 9. Verificar

```bash
~/ps5-remote-web/deploy/ps5ctl.sh status
```

Debe mostrar `web: ok` y `media: ok`. Después:

- `curl -s http://127.0.0.1:8080/api/health` responde `{"ok":true}`.
- `lsof -nP -iTCP:8080 -sTCP:LISTEN` muestra que escucha **solo** en `127.0.0.1`.
- Felipe abre la página, entra como admin y hace una partida de prueba desde otro computador de la red.
- Reiniciar el Mac y repetir `ps5ctl.sh status`: los dos servicios deben volver solos.

## Operación

| Qué | Comando |
|---|---|
| Estado | `deploy/ps5ctl.sh status` |
| Últimos logs | `deploy/ps5ctl.sh logs` |
| Reiniciar | `deploy/ps5ctl.sh restart` (sudo) |
| Detener | `deploy/ps5ctl.sh stop` (sudo) |
| Actualizar | `git pull --recurse-submodules && deploy/install.sh && deploy/ps5ctl.sh restart` |

## Revertir

```bash
~/ps5-remote-web/deploy/ps5ctl.sh stop
sudo rm /Library/LaunchDaemons/com.ps5stream.media.plist /Library/LaunchDaemons/com.ps5stream.web.plist
```

Con eso el Mac queda como antes. El repo, `~/.config/ps5-stream` y `~/.local/share/ps5-stream` se pueden borrar después si Felipe lo pide; no hacerlo por iniciativa propia, porque ahí están las cuentas y las reservas.

## Qué reportarle a Felipe al terminar

- Salida de `ps5ctl.sh status`.
- Cualquier ajuste que haya hecho falta para compilar en Intel, con el comando exacto, para dejarlo en `media/build.sh`.
- Uso de CPU de `media` durante una partida y si afectó al servidor de Minecraft.
- Lo que quedó pendiente (por ejemplo, si se usó `elepew` en vez de `ps5stream`).
